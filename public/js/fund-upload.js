// Fundamental upload handler
document.addEventListener('DOMContentLoaded', function() {
  var el = document.getElementById('fundfi');
  if (el) {
    el.addEventListener('change', async function() {
      if (!this.files.length) return;
      var info = document.getElementById('sdrop-info');
      if (info) info.textContent = 'Uploading fundamental data...';
      var fd = new FormData();
      fd.append('file', this.files[0]);
      try {
        var r = await fetch('/api/idx/fundamental/upload', { method: 'POST', body: fd });
        var d = await r.json();
        if (d.success) {
          if (info) info.textContent = '✅ Fundamental: ' + d.count + ' stocks loaded (' + d.snapshot_month + ')';
          showT('Fundamental', d.count + ' stocks loaded');
        } else {
          if (info) info.textContent = '❌ ' + (d.error || 'Failed');
        }
      } catch (e) { if (info) info.textContent = '❌ ' + e.message; }
      this.value = '';
    });
  }
});
