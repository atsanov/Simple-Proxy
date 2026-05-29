// static/app.js
const form = document.getElementById('proxy-form');
const input = document.getElementById('url-input');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  let url = input.value.trim();
  
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  
  // XORエンコードして /bare/ 経由でリダイレクト
  const encoded = __uv$config.encodeUrl(url);
  window.location.href = '/bare/' + encoded;
});

// Enterキーで送信
input.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') form.requestSubmit();
});