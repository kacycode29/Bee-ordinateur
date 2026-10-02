/* BEE — Burkina English Express · Lesson Plan Generator
   Enveloppe Windows (Electron). Le logiciel lui-même est index.html,
   strictement identique au fichier de l'application Android et du fichier PC :
   cette enveloppe ne change rien au contenu pédagogique.

   Elle ajoute trois choses, et trois seulement :
   1. un identifiant d'installation tiré du matériel Windows, pour que
      l'activation lie la licence à UNE machine, comme sur Android ;
   2. l'ouverture des liens externes (WhatsApp) dans le navigateur du système,
      au lieu de faire quitter l'application ;
   3. un menu français réduit : imprimer, zoomer, quitter.
*/
'use strict';

const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION_LOGICIEL = '13.22';

/* ------------------------------------------------------------------
   IDENTIFIANT DE LA MACHINE
   On cherche d'abord le MachineGuid de Windows : il est propre à
   l'installation de Windows, lisible sans droits administrateur, et il ne
   change que si Windows est réinstallé — exactement comme l'ANDROID_ID
   change à la remise à zéro d'un téléphone.
   Si on ne le trouve pas, on essaie l'UUID de la carte mère.
   En dernier recours seulement, on écrit un identifiant tiré au hasard
   dans le dossier de l'application : le comportement redevient alors
   celui du fichier HTML, lié à l'installation et non au matériel.
------------------------------------------------------------------ */

function lireMachineGuid() {
  const essais = [
    ['reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']],
    ['reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']]
  ];
  for (const [cmd, args] of essais) {
    try {
      const sortie = execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const m = sortie.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{16,})/);
      if (m) return 'machineguid:' + m[1].trim().toLowerCase();
    } catch (e) { /* on passe à l'essai suivant */ }
  }
  return null;
}

function lireUuidCarteMere() {
  try {
    const sortie = execFileSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID'
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const v = String(sortie).trim().toLowerCase();
    const inutilisable = !v
      || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v)
      || /^f{8}-f{4}-f{4}-f{4}-f{12}$/.test(v)
      || v.includes('03000200-0400-0500-0006-000700080009'); /* UUID d'usine partagé */
    if (!inutilisable) return 'csproduct:' + v;
  } catch (e) { /* ignoré */ }
  return null;
}

function identifiantDeSecours() {
  const fichier = path.join(app.getPath('userData'), 'installation.id');
  try {
    const v = fs.readFileSync(fichier, 'utf8').trim();
    if (v) return 'installation:' + v;
  } catch (e) { /* premier démarrage */ }
  const v = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, v, 'utf8');
  } catch (e) { /* si l'écriture échoue, l'identifiant changera au prochain lancement */ }
  return 'installation:' + v;
}

let ID_CACHE = null;
let ID_SOURCE = 'inconnue';

function identifiantMachine() {
  if (ID_CACHE) return ID_CACHE;
  let brut = null;
  if (process.platform === 'win32') {
    brut = lireMachineGuid();
    if (brut) ID_SOURCE = 'MachineGuid de Windows';
    if (!brut) { brut = lireUuidCarteMere(); if (brut) ID_SOURCE = 'UUID de la carte mère'; }
  }
  if (!brut) { brut = identifiantDeSecours(); ID_SOURCE = "identifiant d'installation (secours)"; }
  /* On ne transmet jamais la valeur brute : on en publie une empreinte.
     Le préfixe PC- distingue d'un coup d'œil une licence d'ordinateur
     d'une licence Android dans le registre des licences. */
  const empreinte = crypto.createHash('sha256').update('BEE|' + brut).digest('hex').slice(0, 24);
  ID_CACHE = 'PC-' + empreinte;
  return ID_CACHE;
}

ipcMain.on('bee-identifiant', (ev) => { ev.returnValue = identifiantMachine(); });
ipcMain.on('bee-source-identifiant', (ev) => { identifiantMachine(); ev.returnValue = ID_SOURCE; });

/* ------------------------------------------------------------------
   FENÊTRE
------------------------------------------------------------------ */

let fenetre = null;

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 620,
    show: false,
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'icone.ico'),
    title: 'BEE — Lesson Plan Generator',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  fenetre.loadFile(path.join(__dirname, 'index.html'));
  fenetre.once('ready-to-show', () => { fenetre.maximize(); fenetre.show(); });

  /* Le bouton WhatsApp de la page pointe vers wa.me : sans cela,
     l'application quitterait la fiche pour afficher un site web. */
  const versExterieur = (url) => {
    if (/^https?:\/\//i.test(url) || /^(mailto|tel|whatsapp):/i.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
  };
  fenetre.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file://')) { ev.preventDefault(); versExterieur(url); }
  });
  fenetre.webContents.setWindowOpenHandler(({ url }) => { versExterieur(url); return { action: 'deny' }; });

  /* Menu du clic droit. Electron n'en fournit aucun : sans ces lignes,
     un clic droit dans un champ ne propose ni Copier ni Coller, et
     l'enseignant ne peut pas coller son code d'autorisation. */
  fenetre.webContents.on('context-menu', (ev, params) => {
    const f = params.editFlags || {};
    const items = [];
    if (params.isEditable) {
      items.push({ label: 'Annuler', role: 'undo', enabled: !!f.canUndo });
      items.push({ label: 'Rétablir', role: 'redo', enabled: !!f.canRedo });
      items.push({ type: 'separator' });
      items.push({ label: 'Couper', role: 'cut', enabled: !!f.canCut });
      items.push({ label: 'Copier', role: 'copy', enabled: !!f.canCopy });
      items.push({ label: 'Coller', role: 'paste', enabled: !!f.canPaste });
      items.push({ type: 'separator' });
      items.push({ label: 'Tout sélectionner', role: 'selectAll' });
    } else {
      if (params.selectionText && params.selectionText.trim()) {
        items.push({ label: 'Copier', role: 'copy' });
        items.push({ type: 'separator' });
      }
      items.push({ label: 'Tout sélectionner', role: 'selectAll' });
      items.push({ type: 'separator' });
      items.push({ label: 'Imprimer la fiche…', click: () => fenetre.webContents.print({}, () => {}) });
    }
    Menu.buildFromTemplate(items).popup({ window: fenetre });
  });

  fenetre.on('closed', () => { fenetre = null; });
}

/* Le presse-papiers. Le logiciel copie l'identifiant d'installation d'un
   clic ; sans autorisation explicite, Electron refuse l'accès et le bouton
   reste sans effet. Aucune autre autorisation n'est accordée : ni caméra,
   ni micro, ni position, ni notifications. */
function autorisations() {
  const PERMIS = ['clipboard-read', 'clipboard-sanitized-write', 'clipboard-write'];
  session.defaultSession.setPermissionRequestHandler((wc, permission, retour) => {
    retour(PERMIS.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => PERMIS.includes(permission));
}

/* ------------------------------------------------------------------
   MENU — court, en français, sans outils de développement
------------------------------------------------------------------ */

function menu() {
  const modele = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Imprimer la fiche…', accelerator: 'CmdOrCtrl+P',
          click: () => { if (fenetre) fenetre.webContents.print({}, () => {}); } },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { label: 'Annuler', role: 'undo' },
        { label: 'Rétablir', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', role: 'cut' },
        { label: 'Copier', role: 'copy' },
        { label: 'Coller', role: 'paste' },
        { label: 'Tout sélectionner', role: 'selectAll' }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Agrandir le texte', role: 'zoomIn' },
        { label: 'Réduire le texte', role: 'zoomOut' },
        { label: 'Taille normale', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: "Identifiant de cet ordinateur",
          click: () => {
            dialog.showMessageBox(fenetre, {
              type: 'info',
              title: "Identifiant d'installation",
              message: identifiantMachine(),
              detail: "Communiquez cet identifiant au vendeur pour obtenir votre code d'activation.\n\n"
                + "Source : " + ID_SOURCE + "\n"
                + "Cet identifiant ne change pas tant que Windows n'est pas réinstallé.",
              buttons: ['Fermer']
            });
          }
        },
        {
          label: 'À propos',
          click: () => {
            dialog.showMessageBox(fenetre, {
              type: 'info',
              title: 'À propos',
              message: 'BEE — Burkina English Express\nLesson Plan Generator',
              detail: 'Version ' + VERSION_LOGICIEL + '\n'
                + "Conforme aux curricula et aux instructions officielles du Burkina Faso.\n\n"
                + 'Tidiani BARRY, Inspecteur de l’Enseignement secondaire.',
              buttons: ['Fermer']
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(modele));
}

/* Une seule copie de l'application à la fois : un double-clic répété
   ramène la fenêtre déjà ouverte au lieu d'en ouvrir une seconde. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); }
  });
  app.whenReady().then(() => {
    autorisations();
    menu();
    creerFenetre();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) creerFenetre(); });
  });
  app.on('window-all-closed', () => { app.quit(); });
}
