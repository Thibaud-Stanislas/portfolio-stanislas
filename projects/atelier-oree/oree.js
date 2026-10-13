(() => {
  let itemCount = 0;
  const counter = document.getElementById('cart-count');
  const message = document.getElementById('cart-message');
  document.querySelectorAll('.add-product').forEach((button) => {
    button.addEventListener('click', () => {
      itemCount += 1;
      counter.textContent = String(itemCount);
      message.textContent = `${button.dataset.product} ajouté au panier de démonstration — ${button.dataset.price} €. ${itemCount} pièce${itemCount > 1 ? 's' : ''} au panier.`;
    });
  });
})();
