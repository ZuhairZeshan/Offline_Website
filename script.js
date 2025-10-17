const saveBtn = document.getElementById('saveBtn');
const noteField = document.getElementById('note');
const statusMsg = document.getElementById('status');

saveBtn.addEventListener('click', () => {
  const note = noteField.value;
  if (!note.trim()) {
    statusMsg.textContent = "Please enter some text.";
    return;
  }

  // Save note offline
  localStorage.setItem('note', note);
  statusMsg.textContent = "Saved offline ✅";

  // Try to sync immediately if online
  if (navigator.onLine) {
    syncNote();
  }
});

// Sync when internet returns
window.addEventListener('online', syncNote);

function syncNote() {
  const note = localStorage.getItem('note');
  if (!note) return;

  statusMsg.textContent = "Syncing note... 🌐";

  // Replace with your backend API
  fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note })
  })
  .then(res => res.json())
  .then(data => {
    statusMsg.textContent = "Note synced to server ✅";
    localStorage.removeItem('note');
  })
  .catch(() => {
    statusMsg.textContent = "Sync failed, will retry later ⚠️";
  });
}
