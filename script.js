const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '⊘', '⇄', '+2'];

let deck = [];
let discardPile = [];
let players = [];
let activePlayerIndex = 0;
let playDirection = 1;
let currentColor = '';

let roomCode = '';
let myPlayerId = 0;
let isOnline = false;

// DOM Elements
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

// --- GESTION DES SALONS FIREBASE ---

btnCreateRoom.addEventListener('click', () => {
  roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  myPlayerId = 0;
  isOnline = true;

  const maxPlayers = parseInt(selectMaxPlayers.value);
  let initialPlayers = [];
  for (let i = 0; i < maxPlayers; i++) {
    initialPlayers.push({ 
      id: i, 
      name: `Joueur ${i + 1}`, 
      hand: [], 
      joined: (i === 0) // L'hôte rejoint automatiquement
    });
  }

  const initialGameState = {
    status: 'waiting',
    activePlayerIndex: 0,
    playDirection: 1,
    currentColor: 'red',
    deck: [],
    discardPile: [],
    players: initialPlayers
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
  if (code.length !== 4) {
    alert("Entre un code de salon valide à 4 lettres.");
    return;
  }

  roomCode = code;
  isOnline = true;

  const { ref, onValue, update } = window.firebaseRefs;
  onValue(ref(window.db, 'rooms/' + roomCode), (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      alert("Ce salon n'existe pas !");
      isOnline = false;
      return;
    }

    if (data.status === 'waiting') {
      let assignedId = -1;
      for (let i = 0; i < data.players.length; i++) {
        if (!data.players[i].joined) {
          assignedId = i;
          break;
        }
      }

      if (assignedId === -1) {
        alert("Le salon est complet !");
        isOnline = false;
        return;
      }

      myPlayerId = assignedId;
      data.players[myPlayerId].joined = true;

      update(ref(window.db, 'rooms/' + roomCode), { players: data.players });

      lobbyControls.classList.add('hidden');
      roomInfo.classList.remove('hidden');
      displayRoomCode.textContent = roomCode;

      const allJoined = data.players.every(p => p.joined);
      if (allJoined) {
        startOnlineGameFromFirebase(data.players);
      } else {
        elTurnIndicator.textContent = "Connecté ! En attente des autres joueurs...";
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
        const allJoined = data.players.every(p => p.joined);
        if (allJoined && myPlayerId === 0) {
          startOnlineGameFromFirebase(data.players);
        }
      } else if (data.status === 'playing') {
        syncGameState(data);
      }
    }
  });
}

function updateFirebaseState() {
  // On ne bloque plus la mise à jour si le tour vient de passer à l'adversaire
  if (!isOnline) return;

  const { ref, update } = window.firebaseRefs;
  update(ref(window.db, 'rooms/' + roomCode), {
    activePlayerIndex: activePlayerIndex,
    playDirection: playDirection,
    currentColor: currentColor,
    deck: deck,
    discardPile: discardPile,
    players: players
  });
}
function syncGameState(data) {
  activePlayerIndex = data.activePlayerIndex;
  playDirection = data.playDirection;
  currentColor = data.currentColor;
  deck = data.deck || [];
  discardPile = data.discardPile || [];
  players = data.players || [];

  renderTable();

  const currentPlayer = players[activePlayerIndex];
  if (activePlayerIndex === myPlayerId) {
    elTurnIndicator.innerHTML = `<span style="color: #2ecc71;">C'est à TON tour !</span> (Couleur : ${getFrenchColor(currentColor)})`;
  } else {
    elTurnIndicator.textContent = `Au tour de ${currentPlayer.name} (Couleur : ${getFrenchColor(currentColor)})`;
  }
}

// --- LOGIQUE DU JEU UNO ---

function createDeck() {
  deck = [];
  COLORS.forEach(color => {
    deck.push({ color, value: '0' });
    for (let i = 1; i <= 9; i++) {
      deck.push({ color, value: i.toString() });
      deck.push({ color, value: i.toString() });
    }
    ['⊘', '⇄', '+2'].forEach(val => {
      deck.push({ color, value: val });
      deck.push({ color, value: val });
    });
  });
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'black', value: '🎨' });
    deck.push({ color: 'black', value: '+4' });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function drawCard(player, count = 1) {
  // Sécurité Firebase : si le tableau 'hand' a disparu car il était vide, on le recrée
  if (!player.hand) {
    player.hand = [];
  }

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
      newCard.isNew = true;
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

  const { ref, update } = window.firebaseRefs;
  update(ref(window.db, 'rooms/' + roomCode), {
    status: 'playing',
    activePlayerIndex: activePlayerIndex,
    playDirection: playDirection,
    currentColor: currentColor,
    deck: deck,
    discardPile: discardPile,
    players: players
  });
}

function renderTable() {
  if (discardPile.length === 0) return;
  const topCard = discardPile[discardPile.length - 1];
  
  // Défausse
  elDiscardPile.innerHTML = '';
  const cardEl = document.createElement('div');
  cardEl.className = `card ${currentColor === 'black' ? topCard.color : currentColor}`;
  cardEl.innerHTML = `<span>${topCard.value}</span>`;
  elDiscardPile.appendChild(cardEl);

  // Adversaires (Répartition dynamique autour de la table)
  elOpponents.innerHTML = '';
  players.forEach((p, index) => {
    if (index !== myPlayerId) {
      const oppZone = document.createElement('div');
      
      const diff = (index - myPlayerId + players.length) % players.length;
      let posClass = 'pos-top';
      
      if (players.length === 3) {
        if (diff === 1) posClass = 'pos-left';
        if (diff === 2) posClass = 'pos-right';
      } else if (players.length >= 4) {
        if (diff === 1) posClass = 'pos-left';
        if (diff === Math.floor(players.length / 2)) posClass = 'pos-top';
        if (diff > Math.floor(players.length / 2)) posClass = 'pos-right';
      }

      oppZone.className = `opponent-zone ${posClass}`;
      
      const nameEl = document.createElement('div');
      nameEl.className = 'opponent-name';
      nameEl.textContent = `${p.name} (${p.hand.length})`;
      
      const handEl = document.createElement('div');
      handEl.className = 'opponent-hand';
      
      p.hand.forEach(() => {
        const cEl = document.createElement('div');
        cEl.className = 'card back';
        handEl.appendChild(cEl);
      });
      
      oppZone.appendChild(nameEl);
      oppZone.appendChild(handEl);
      elOpponents.appendChild(oppZone);
    }
  });

  // Main du joueur
  const myPlayer = players[myPlayerId];
  if (!myPlayer) return;

  elActivePlayerName.textContent = `${myPlayer.name} (Toi)`;
  elActiveHand.innerHTML = '';
  
  myPlayer.hand.forEach((card, index) => {
    const cEl = document.createElement('div');
    const isMyTurn = (activePlayerIndex === myPlayerId);
    const playable = isMyTurn && isPlayable(card);
    
    cEl.className = `card ${card.color} ${!playable ? 'unplayable' : ''}`;
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
  renderTable();

  activePlayerIndex = (activePlayerIndex + playDirection + players.length) % players.length;
  updateFirebaseState();
});

function playCard(cardIndex) {
  const currentPlayer = players[myPlayerId];
  const card = currentPlayer.hand.splice(cardIndex, 1)[0];
  discardPile.push(card);
  currentColor = card.color;
  renderTable();

  if (currentPlayer.hand.length === 0) {
    elTurnIndicator.textContent = `🎉 ${currentPlayer.name} a gagné la partie ! 🎉`;
    elActiveHand.innerHTML = '';
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
    renderTable();
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
