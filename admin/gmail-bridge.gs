const PORTFOLIO_API_BASE = '__PORTFOLIO_API_BASE__';
const PORTFOLIO_PAIRING_CODE = '__PORTFOLIO_PAIRING_CODE__';
const PORTFOLIO_TOKEN_KEY = 'portfolio_email_bridge_token';

function connectPortfolioEmail() {
  if (!/^https:\/\//.test(PORTFOLIO_API_BASE) || PORTFOLIO_PAIRING_CODE.indexOf('__PORTFOLIO_') === 0) {
    throw new Error('Reprenez la préparation depuis la page admin pour obtenir un code de liaison.');
  }

  GmailApp.getAliases();
  const accountEmail = Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail();
  if (!accountEmail) throw new Error('Google ne renvoie pas votre adresse. Vérifiez que vous êtes connecté au bon compte Gmail.');

  const response = UrlFetchApp.fetch(PORTFOLIO_API_BASE + '/api/email/bridge/pair', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ pairingCode: PORTFOLIO_PAIRING_CODE, accountEmail: accountEmail }),
    muteHttpExceptions: true
  });
  const result = parseResponse(response);
  if (!result.success || !result.token) throw new Error(result.message || 'La liaison n’a pas abouti. Relancez-la depuis l’administration.');

  PropertiesService.getScriptProperties().setProperties({
    [PORTFOLIO_TOKEN_KEY]: result.token,
    portfolio_email_address: result.accountEmail
  });
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncPortfolioEmail') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('syncPortfolioEmail').timeBased().everyMinutes(1).create();
  syncPortfolioEmail();
  Logger.log('Gmail est relié au portfolio. Les messages sont synchronisés automatiquement.');
}

function syncPortfolioEmail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    sendPendingReplies();
    importCustomerReplies();
  } catch (error) {
    Logger.log(String(error && error.message ? error.message : error));
    if (String(error && error.message).indexOf('BRIDGE_REVOKED') !== -1) {
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (trigger.getHandlerFunction() === 'syncPortfolioEmail') ScriptApp.deleteTrigger(trigger);
      });
      PropertiesService.getScriptProperties().deleteProperty(PORTFOLIO_TOKEN_KEY);
    }
  } finally {
    lock.releaseLock();
  }
}

function sendPendingReplies() {
  const queue = bridgeRequest('/email/bridge/sync/outbox/claim', 'post', {});
  (queue.replies || []).forEach(function (reply) {
    try {
      const sent = sendReply(reply);
      bridgeRequest('/email/bridge/sync/outbox/' + reply.id + '/sent', 'post', sent);
    } catch (error) {
      bridgeRequest('/email/bridge/sync/outbox/' + reply.id + '/failed', 'post', {
        message: 'Gmail n’a pas pu envoyer cette réponse. Vérifiez la connexion Google, puis réessayez depuis l’administration.'
      });
      Logger.log('Échec de l’envoi pour la réponse ' + reply.id + ': ' + String(error && error.message ? error.message : error));
    }
  });
}

function sendReply(reply) {
  const marker = replyMarker(reply.messageId, reply.id);
  let thread = reply.gmailThreadId ? GmailApp.getThreadById(reply.gmailThreadId) : null;
  if (thread) {
    const existing = findMessageByMarker(thread, marker);
    if (existing) return { gmailThreadId: thread.getId(), gmailMessageId: existing.getId() };
    const sent = thread.reply(reply.body + '\n\nRéférence de suivi : ' + marker);
    return { gmailThreadId: thread.getId(), gmailMessageId: sent.getId() };
  }

  const previousDelivery = findSentThread(reply.email, reply.messageId, marker);
  if (previousDelivery) {
    const existing = findMessageByMarker(previousDelivery, marker);
    return { gmailThreadId: previousDelivery.getId(), gmailMessageId: existing ? existing.getId() : null };
  }

  const subject = 'Suite à votre demande de contact · dossier ' + reply.messageId;
  const body = 'Bonjour ' + (reply.name || '') + ',\n\n' + reply.body +
    '\n\nRéférence de suivi : ' + marker + '\n\nBonne journée,\nStanislas';
  GmailApp.sendEmail(reply.email, subject, body, { name: 'Stanislas' });

  const sentThread = findSentThread(reply.email, reply.messageId, marker);
  if (!sentThread) return { gmailThreadId: null, gmailMessageId: null };
  const sentMessage = findMessageByMarker(sentThread, marker);
  return { gmailThreadId: sentThread.getId(), gmailMessageId: sentMessage ? sentMessage.getId() : null };
}

function importCustomerReplies() {
  const result = bridgeRequest('/email/bridge/sync/conversations', 'get');
  (result.conversations || []).forEach(function (conversation) {
    let threadId = conversation.gmailThreadId;
    if (!threadId) {
      const thread = findSentThread(conversation.email, conversation.messageId, null);
      if (!thread) return;
      threadId = thread.getId();
      bridgeRequest('/email/bridge/sync/conversations/' + conversation.messageId + '/thread', 'post', { gmailThreadId: threadId });
    }

    try {
      const thread = GmailApp.getThreadById(threadId);
      const known = new Set(conversation.knownMessageIds || []);
      thread.getMessages().forEach(function (message) {
        const gmailMessageId = message.getId();
        const from = extractEmail(message.getFrom());
        if (!gmailMessageId || known.has(gmailMessageId) || !from) return;
        const body = message.getPlainBody().trim().slice(0, 10000);
        if (!body) return;
        bridgeRequest('/email/bridge/sync/incoming', 'post', {
          messageId: conversation.messageId,
          gmailThreadId: threadId,
          gmailMessageId: gmailMessageId,
          from: from,
          body: body,
          receivedAt: message.getDate().toISOString()
        });
      });
    } catch (error) {
      Logger.log('Impossible de synchroniser le dossier ' + conversation.messageId + ': ' + String(error && error.message ? error.message : error));
    }
  });
}

function findSentThread(email, messageId, marker) {
  const safeEmail = String(email || '').replace(/[^A-Za-z0-9.@_+-]/g, '');
  if (!safeEmail) return null;
  const query = 'in:sent to:' + safeEmail + ' newer_than:14d ' +
    (marker ? '"' + marker + '"' : 'subject:"dossier ' + messageId + '"');
  const threads = GmailApp.search(query, 0, 10);
  for (let index = threads.length - 1; index >= 0; index -= 1) {
    const thread = threads[index];
    if (!marker || findMessageByMarker(thread, marker)) return thread;
  }
  return null;
}

function findMessageByMarker(thread, marker) {
  const messages = thread.getMessages();
  const ownerEmail = String(PropertiesService.getScriptProperties().getProperty('portfolio_email_address') || '').toLowerCase();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if ((!ownerEmail || extractEmail(message.getFrom()) === ownerEmail) && message.getPlainBody().indexOf(marker) !== -1) return message;
  }
  return null;
}

function replyMarker(messageId, replyId) {
  return 'P-' + messageId + '-R-' + replyId;
}

function extractEmail(value) {
  const match = /<([^<>]+)>/.exec(String(value || ''));
  const email = (match ? match[1] : String(value || '')).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function bridgeRequest(path, method, body) {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty(PORTFOLIO_TOKEN_KEY);
  if (!token) throw new Error('BRIDGE_REVOKED: reconnectez Gmail depuis la page admin.');
  const options = {
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  const response = UrlFetchApp.fetch(PORTFOLIO_API_BASE + '/api' + path, options);
  const result = parseResponse(response);
  if (response.getResponseCode() === 401) throw new Error('BRIDGE_REVOKED: reconnectez Gmail depuis la page admin.');
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || result.success === false) {
    throw new Error(result.message || 'Le serveur du portfolio est temporairement indisponible.');
  }
  return result;
}

function parseResponse(response) {
  const text = response.getContentText();
  try {
    return JSON.parse(text || '{}');
  } catch (error) {
    return { success: false, message: 'La réponse du portfolio est invalide.' };
  }
}

