/* Pont entre l'enveloppe Windows et la page du logiciel.

   La page interroge « AndroidBridge.stableDeviceId() » pour obtenir un
   identifiant lié au matériel. Ce nom vient de la version Android, où le
   pont a été écrit en premier. Plutôt que de modifier index.html — qui doit
   rester rigoureusement identique sur les trois supports — l'enveloppe
   Windows se présente sous ce même nom, et sous un nom propre
   (BeeDesktopBridge) que les versions suivantes du logiciel pourront lire.

   Rien d'autre ne traverse ce pont : pas de fichier, pas de réseau.
*/
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

let identifiant = '';
try { identifiant = ipcRenderer.sendSync('bee-identifiant') || ''; } catch (e) { identifiant = ''; }

const pont = {
  stableDeviceId: () => identifiant,
  platform: () => 'windows-desktop'
};

contextBridge.exposeInMainWorld('BeeDesktopBridge', pont);
contextBridge.exposeInMainWorld('AndroidBridge', pont);
