function search() {
  let requestedSite = document.getElementById('searchBox').value.trim();
  if (!requestedSite) return;

  const looksLikeDomain = /\.[a-z]{2,}$/i.test(requestedSite);

  let targetUrl;
  if (looksLikeDomain) {
    if (!requestedSite.startsWith('http://') && !requestedSite.startsWith('https://')) {
      requestedSite = 'https://' + requestedSite;
    }
    targetUrl = requestedSite;
  } else {
    targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(requestedSite);
  }

  window.location.href = '/proxy?url=' + encodeURIComponent(targetUrl);
}

window.onload = function () {
  document.getElementById('searchBox').addEventListener('keydown', function (event) {
    if (event.key === 'Enter') search();
  });
};
function suggest() {
  window.open("https://forms.gle/Ww1f47VPdLDW7DH89")
}
function openGit() {
  window.open("https://github.com/Peeves426")
}

