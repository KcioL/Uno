const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '⊘', '⇄', '+2'];

let deck = [];
let discardPile = [];
let players = [];
let activePlayerIndex = 0;
let playDirection = 1;
let currentColor = '';

// Nouveaux états pour le multijoueur
let roomCode = '';
let myPlayerId = 0;
let isOnline = false;
let gameStatus = 'waiting'; // 'waiting', 'playing', 'finished'
let winner = null;
let unoVulnerablePlayer = null; // ID du joueur à qui il reste 1 carte

// DOM Elements
const playerNameInput = document.getElementById('player-name-input');
const lobbyControls = document.getElementById('lobby-controls');
const roomInfo = document.getElementById('room-info');
const displayRoomCode = document.getElementById('display-room-code');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const selectMaxPlayers = document.getElementById('select-max-players');

const elOpponents = document.getElementById('opponents-container');
const elDrawPile = document.getElementById('draw-pile');
const elDiscardPile = document.getElementById('discard-pile');
const elActiveHand = document.getElementById('active-hand');
const elActivePlayerName = document.getElementById('active-player-name');
const elTurnIndicator = document.getElementById('turn-indicator');
const colorPickerOverlay = document.getElementById('color-picker-overlay');

// --- CREATION DYNAMIQUE DES ELEMENTS UNO & VICTOIRE ---
const btnUno = document.createElement('button');
btnUno.className = 'uno-btn';
btnUno.textContent = 'UNO !';
document.body.appendChild(btnUno);

const btnContre = document.createElement('button');
btnContre.className = 'contre-uno-btn';
btnContre.textContent = 'Contre UNO !';
document.body.appendChild(btnContre);

const winScreen = document.createElement('div');
winScreen.className = 'win-overlay hidden';
document.body.appendChild(winScreen);

// --- LOGIQUE DES BOUTONS UNO ---
btnUno.addEventListener('click', () => {
  if (unoVulnerablePlayer === myPlayerId) {
    unoVulnerablePlayer = null; // Protégé !
    updateFirebaseState();
    elTurnIndicator.textContent = "Tu as annoncé UNO ! Tu es protégé.";
  }
});

btnContre.addEventListener('click', () => {
  if (unoVulnerablePlayer !== null && unoVulnerablePlayer !== myPlayerId) {
    // Punition : le joueur vulnérable pioche 2 cartes
    const vulnerable = players[unoVulnerablePlayer];
    drawCard(vulnerable, 2);
    const punishedName = vulnerable.name;
    unoVulnerablePlayer = null;
    updateFirebaseState();
    alert(`Contre UNO réussi ! ${punishedName} a oublié de dire UNO et pioche 2 cartes.`);
  }
});

// --- GESTION DES SALONS FIREBASE ---

btnCreateRoom.addEventListener('click', () => {
  roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  myPlayerId = 0;
  isOnline = true;

  // On récupère le pseudo (ou on met "Hôte" par défaut s'il n'a rien écrit)
  const myName = playerNameInput.value.trim() || 'Hôte';

  const maxPlayers = parseInt(selectMaxPlayers.value);
  let initialPlayers = [];
  for (let i = 0; i < maxPlayers; i++) {
    // Le créateur prend la place 0, les autres sont "En attente"
    initialPlayers.push({ 
      id: i, 
      name: (i === 0) ? myName : 'En attente...', 
      hand: [], 
      joined: (i === 0) 
    });
  }

  const initialGameState = {
    status: 'waiting',
    activePlayerIndex: 0,
    playDirection: 1,
    currentColor: 'red',
    deck: [],
    discardPile: [],
    players: initialPlayers,
    winner: null,
    unoVulnerablePlayer: null
  };

  const { ref, set } = window.firebaseRefs;
  set(ref(window.db, 'rooms/' + roomCode), initialGameState).then(() => {
    lobbyControls.classList.add('hidden');
    roomInfo.classList.remove('hidden');
    displayRoomCode.textContent = roomCode;
    elTurnIndicator.textContent = `Salon créé ! En attente des joueurs (1/${maxPlayers})...`;
    listenToRoom();
  });
});

btnJoinRoom.addEventListener('click', () => {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length !== 4) return alert("Entre un code à 4 lettres.");

  roomCode = code;
  isOnline = true;

  const { ref, onValue, update } = window.firebaseRefs;
  onValue(ref(window.db, 'rooms/' + roomCode), (snapshot) => {
    const data = snapshot.val();
    if (!data) return alert("Ce salon n'existe pas !");

    if (data.status === 'waiting') {
      let assignedId = -1;
      for (let i = 0; i < data.players.length; i++) {
        if (!data.players[i].joined) { assignedId = i; break; }
      }

      if (assignedId === -1) return alert("Le salon est complet !");
      myPlayerId = assignedId;
      
      // On récupère le pseudo du joueur qui rejoint
      const myName = playerNameInput.value.trim() || `Joueur ${myPlayerId + 1}`;
      data.players[myPlayerId].joined = true;
      data.players[myPlayerId].name = myName;

      update(ref(window.db, 'rooms/' + roomCode), { players: data.players });

      lobbyControls.classList.add('hidden');
      roomInfo.classList.remove('hidden');
      displayRoomCode.textContent = roomCode;

      if (data.players.every(p => p.joined)) {
        startOnlineGameFromFirebase(data.players);
      } else {
        elTurnIndicator.textContent = "Connecté ! En attente...";
      }
    } else {
      syncGameState(data);
    }
  }, { onlyOnce: true });

  listenToRoom();
});

function listenToRoom() {
  const { ref, onValue } = window.firebaseRefs;
  onValue(ref(window.db, 'rooms/' + roomCode), (snapshot) => {
    const data = snapshot.val();
    if (data) {
      if (data.status === 'waiting') {
        const joinedCount = data.players.filter(p => p.joined).length;
        elTurnIndicator.textContent = `En attente des joueurs (${joinedCount}/${data.players.length})...`;
        if (data.players.every(p => p.joined) && myPlayerId === 0) {
          startOnlineGameFromFirebase(data.players);
        }
      } else {
        syncGameState(data);
      }
    }
  });
}

function updateFirebaseState() {
  if (!isOnline) return;

  const { ref, update } = window.firebaseRefs;
  update(ref(window.db, 'rooms/' + roomCode), {
    status: gameStatus,
    activePlayerIndex: activePlayerIndex,
    playDirection: playDirection,
    currentColor: currentColor,
    deck: deck,
    discardPile: discardPile,
    players: players,
    winner: winner,
    unoVulnerablePlayer: unoVulnerablePlayer
  });
}

function syncGameState(data) {
  gameStatus = data.status || 'waiting';
  activePlayerIndex = data.activePlayerIndex;
  playDirection = data.playDirection;
  currentColor = data.currentColor;
  deck = data.deck || [];
  discardPile = data.discardPile || [];
  players = data.players || [];
  winner = data.winner !== undefined ? data.winner : null;
  unoVulnerablePlayer = data.unoVulnerablePlayer !== undefined ? data.unoVulnerablePlayer : null;

  renderTable();

  if (gameStatus === 'playing') {
    const currentPlayer = players[activePlayerIndex];
    if (activePlayerIndex === myPlayerId) {
      elTurnIndicator.innerHTML = `<span style="color: #2ecc71;">C'est à TON tour !</span> (Couleur : ${getFrenchColor(currentColor)})`;
    } else {
      elTurnIndicator.textContent = `Au tour de ${currentPlayer.name} (Couleur : ${getFrenchColor(currentColor)})`;
    }
  }
}

// --- LOGIQUE DU JEU UNO ---

function createDeck() {
  deck = [];
  COLORS.forEach(color => {
    deck.push({ color, value: '0' });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color, value: i.toString() }); deck.push({ color, value: i.toString() });
    }
    ['⊘', '⇄', '+2'].forEach(val => {
      deck.push({ color, value: val }); deck.push({ color, value: val });
    });
  });
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'black', value: '🎨' }); deck.push({ color: 'black', value: '+4' });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function drawCard(player, count = 1) {
  if (!player.hand) player.hand = [];
  
  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      const topDiscard = discardPile.pop();
      deck = [...discardPile];
      discardPile = [topDiscard];
      deck.forEach(c => { if(c.value === '🎨' || c.value === '+4') c.color = 'black'; });
      deck.sort(() => Math.random() - 0.5);
    }
    if (deck.length > 0) {
      const newCard = deck.pop();
      newCard.isNew = true; // Pour l'animation
      player.hand.push(newCard);
    }
  }
}

function isPlayable(card) {
  const topCard = discardPile[discardPile.length - 1];
  if (card.color === 'black') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function startOnlineGameFromFirebase(currentPlayersData) {
  createDeck();
  discardPile = [];
  playDirection = 1;
  activePlayerIndex = 0;
  gameStatus = 'playing';
  winner = null;
  unoVulnerablePlayer = null;

  players = currentPlayersData;
  players.forEach(p => drawCard(p, 7));

  let firstCard;
  do {
    firstCard = deck.pop();
    if (firstCard.color === 'black' || ['⊘', '⇄', '+2'].includes(firstCard.value)) {
      deck.unshift(firstCard);
    } else {
      discardPile.push(firstCard);
    }
  } while (discardPile.length === 0);

  currentColor = firstCard.color;
  updateFirebaseState();
}

function renderTable() {
  if (gameStatus === 'finished') {
    winScreen.innerHTML = `<div>🎉 ${players[winner].name} a gagné ! 🎉</div>`;
    winScreen.classList.remove('hidden');
    btnUno.style.display = 'none';
    btnContre.style.display = 'none';
    return;
  } else {
    winScreen.classList.add('hidden');
  }

  // Gestion de l'affichage des boutons UNO
  if (unoVulnerablePlayer !== null) {
    if (unoVulnerablePlayer === myPlayerId) {
      btnUno.style.display = 'block';
      btnContre.style.display = 'none';
    } else {
      btnUno.style.display = 'none';
      btnContre.style.display = 'block';
      
      // Positionnement aléatoire pour "Contre UNO"
      if (btnContre.dataset.active !== "true") {
        btnContre.style.left = Math.floor(Math.random() * 50 + 20) + 'vw';
        btnContre.style.top = Math.floor(Math.random() * 50 + 20) + 'vh';
        btnContre.dataset.active = "true";
      }
    }
  } else {
    btnUno.style.display = 'none';
    btnContre.style.display = 'none';
    btnContre.dataset.active = "false";
  }

  if (discardPile.length === 0) return;
  const topCard = discardPile[discardPile.length - 1];
  
  // Défausse avec animation
  elDiscardPile.innerHTML = '';
  const cardEl = document.createElement('div');
  cardEl.className = `card ${currentColor === 'black' ? topCard.color : currentColor} anim-play`;
  cardEl.innerHTML = `<span>${topCard.value}</span>`;
  elDiscardPile.appendChild(cardEl);

  // Adversaires
  elOpponents.innerHTML = '';
  
  const numOpponents = players.length - 1;
  let positions = [];
  if (numOpponents === 1) positions = ['pos-top'];
  else if (numOpponents === 2) positions = ['pos-left', 'pos-right'];
  else if (numOpponents === 3) positions = ['pos-left', 'pos-top', 'pos-right'];
  else if (numOpponents === 4) positions = ['pos-left', 'pos-top-left', 'pos-top-right', 'pos-right'];
  else if (numOpponents === 5) positions = ['pos-left', 'pos-top-left', 'pos-top', 'pos-top-right', 'pos-right'];

  for (let i = 1; i <= numOpponents; i++) {
    const oppIndex = (myPlayerId + i) % players.length;
    const p = players[oppIndex];
    const posClass = positions[i - 1];

    const oppZone = document.createElement('div');
    oppZone.className = `opponent-zone ${posClass}`;
    
    const nameEl = document.createElement('div');
    nameEl.className = 'opponent-name';
    
    if (activePlayerIndex === oppIndex) {
      nameEl.style.color = '#f1c40f';
      nameEl.style.border = '2px solid #f1c40f';
      nameEl.textContent = `▶ ${p.name} (${p.hand ? p.hand.length : 0})`;
    } else {
      nameEl.textContent = `${p.name} (${p.hand ? p.hand.length : 0})`;
    }
    
    const handEl = document.createElement('div');
    handEl.className = 'opponent-hand';
    
    if (p.hand) {
      p.hand.forEach((c) => {
        const cEl = document.createElement('div');
        cEl.className = 'card back';
        if (c.isNew) {
          cEl.classList.add('anim-draw');
        }
        handEl.appendChild(cEl);
      });
    }
    
    oppZone.appendChild(nameEl);
    oppZone.appendChild(handEl);
    elOpponents.appendChild(oppZone);
  }

  // Main du joueur
  const myPlayer = players[myPlayerId];
  if (!myPlayer || !myPlayer.hand) return;

  elActivePlayerName.textContent = `${myPlayer.name} (Toi)`;
  elActiveHand.innerHTML = '';
  
  myPlayer.hand.forEach((card, index) => {
    const cEl = document.createElement('div');
    const isMyTurn = (activePlayerIndex === myPlayerId);
    const playable = isMyTurn && isPlayable(card);
    
    cEl.className = `card ${card.color} ${!playable ? 'unplayable' : ''}`;
    if (card.isNew) {
      cEl.classList.add('anim-draw');
      card.isNew = false;
    }
    
    cEl.innerHTML = `<span>${card.value}</span>`;
    
    cEl.addEventListener('click', () => {
      if (isMyTurn && isPlayable(card)) {
        playCard(index);
      }
    });
    elActiveHand.appendChild(cEl);
  });
}

elDrawPile.addEventListener('click', () => {
  if (!isOnline || activePlayerIndex !== myPlayerId) return;

  const currentPlayer = players[myPlayerId];
  drawCard(currentPlayer, 1);
  
  if (unoVulnerablePlayer === myPlayerId) {
    unoVulnerablePlayer = null;
  }

  activePlayerIndex = (activePlayerIndex + playDirection + players.length) % players.length;
  updateFirebaseState();
});

function playCard(cardIndex) {
  const currentPlayer = players[myPlayerId];
  const card = currentPlayer.hand.splice(cardIndex, 1)[0];
  discardPile.push(card);
  currentColor = card.color;

  if (currentPlayer.hand.length === 1) {
    unoVulnerablePlayer = myPlayerId;
  } else if (unoVulnerablePlayer === myPlayerId) {
    unoVulnerablePlayer = null;
  }

  if (currentPlayer.hand.length === 0) {
    gameStatus = 'finished';
    winner = myPlayerId;
    updateFirebaseState();
    return;
  }

  if (card.color === 'black') {
    colorPickerOverlay.classList.remove('hidden');
    window.pendingCardValue = card.value;
  } else {
    applySpecialEffects(card.value);
  }
}

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    currentColor = e.target.getAttribute('data-color');
    colorPickerOverlay.classList.add('hidden');
    applySpecialEffects(window.pendingCardValue);
  });
});

function applySpecialEffects(cardValue) {
  let skipNext = false;
  const nextPlayerIdx = (activePlayerIndex + playDirection + players.length) % players.length;
  const nextPlayer = players[nextPlayerIdx];

  if (cardValue === '⇄') {
    if (players.length === 2) skipNext = true;
    else playDirection *= -1;
  } else if (cardValue === '⊘') {
    skipNext = true;
  } else if (cardValue === '+2') {
    skipNext = true;
    drawCard(nextPlayer, 2);
  } else if (cardValue === '+4') {
    skipNext = true;
    drawCard(nextPlayer, 4);
  }

  let steps = skipNext ? 2 : 1;
  activePlayerIndex = (activePlayerIndex + (playDirection * steps) + players.length) % players.length;

  updateFirebaseState();
}

function getFrenchColor(color) {
  const dict = { red: 'Rouge', blue: 'Bleu', green: 'Vert', yellow: 'Jaune', black: 'Couleur' };
  return dict[color] || color;
}
