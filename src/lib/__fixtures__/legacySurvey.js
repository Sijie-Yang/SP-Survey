// A hand-written survey page of the kind researchers already have: its own
// design, an external script, and results posted to its own server.
export const LEGACY_SURVEY_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Street study</title>
<script src="https://cdn.legacy-lab.org/ui.js"></script>
<style>body{font-family:Georgia;background:#f4efe6}</style></head>
<body>
<h1>How safe does this street feel?</h1>
<img id="scene" src="https://legacy-lab.org/img/street_01.jpg" alt="street">
<form id="f">
  <label><input type="radio" name="safety" value="1">1</label>
  <label><input type="radio" name="safety" value="5">5</label>
  <textarea name="comment"></textarea>
  <button type="submit">Send</button>
</form>
<p id="thanks" hidden>Thank you!</p>
<script>
document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var data = Object.fromEntries(new FormData(e.target));
  fetch('https://api.legacy-lab.org/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(function () { document.getElementById('thanks').hidden = false; });
});
</script>
</body></html>`;

export const LEGACY_SURVEY_CONVERSION = {
  survey: {
    title: 'Street study',
    pages: [{
      name: 'page1',
      elements: [
        { type: 'rating', name: 'safety', title: 'How safe does this street feel?', rateMin: 1, rateMax: 5, isRequired: true },
        { type: 'comment', name: 'comment', title: 'Comment' },
      ],
    }],
  },
  adapterScript: `SPSite.onReady(function () {});
SPSite.onSubmit(function (item) {
  var d = item.data || {};
  Promise.all([
    SPSite.answer('safety', Number(d.safety)),
    SPSite.answer('comment', d.comment || null)
  ]).then(function () { return SPSite.complete(); });
});`,
  replacements: [{ find: '<title>Street study</title>', replace: '<title>Street study (SP-Survey)</title>' }],
  externalHosts: [{ host: 'cdn.legacy-lab.org', why: 'UI script' }],
  originalImages: [{ url: 'https://legacy-lab.org/img/street_01.jpg', note: 'scene' }],
  notes: ['Results that were posted to api.legacy-lab.org are now recorded by SP-Survey.'],
};
