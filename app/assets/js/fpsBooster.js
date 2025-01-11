const { ipcRenderer } = require('electron');

document.getElementById('applyBtn').addEventListener('click', async () => {
  const profile = document.getElementById('profileSelector').value;
  const response = await ipcRenderer.invoke('apply-profile', profile);

  const messageElement = document.getElementById('statusMessage');
  messageElement.textContent = response.message;
  messageElement.style.color = response.success ? 'green' : 'red';
});
