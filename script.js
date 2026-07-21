const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '⊘', '⇄', '+2'];

let deck = [];
let discardPile = [];
let players = [];
let activePlayerIndex = 0;
let playDirection = 1;
let currentColor = '';

// Nouveaux états
let roomCode = '';
let myPlayerId = 0;
let isOnline = false;
let gameStatus = 'waiting';
let winner = null;
let unoVulnerablePlayer = null; 
let actionLocked = false; 
let drawPenalty = 0; // NOUVEAU : Cumul des +2

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

// Écrans dynamiques
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
winScreen.innerHTML = `
  <div id="win-text"></div>
  <button id="btn-replay" style="margin-top: 40px; padding: 15px 30px; font-size: 24px; font-weight: bold; cursor: pointer; border-radius: 10px; border: none; background: #2ecc71; color: white; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">Rejouer la partie</button>
`;
document.body.appendChild(winScreen);

// Boutons UNO & Rejouer
btnUno.addEventListener('click', () => {
  if (unoVulnerablePlayer === myPlayerId) {
    unoVulnerablePlayer = null;
    updateFirebaseState();
    elTurnIndicator.textContent = "Tu as annoncé UNO ! Tu es protégé.";
  }
});

btnContre.addEventListener('click', () => {
  if (unoVulnerablePlayer !== null && unoVulnerablePlayer !== myPlayerId) {
    const vulnerable = players[unoVulnerablePlayer];
    drawCard(vulnerable, 2);
    const punishedName = vulnerable.name;
    unoVulnerablePlayer = null;
    updateFirebaseState();
    alert(`Contre UNO réussi ! ${punishedName} a oublié de dire UNO et pioche 2 cartes.`);
  }
});

document.getElementById('btn-replay').addEventListener('click', () => {
  if (myPlayerId === 0) {
    // Seul l'hôte génère la nouvelle partie et tire au sort !
    startOnlineGameFromFirebase(players);
  } else {
    alert("Seul l'hôte (Joueur 1) peut relancer la partie !");
    elTurnIndicator.textContent = "En attente de l'hôte pour rejouer...";
  }
});

// Salons Firebase
btnCreateRoom.addEventListener('click', () => {
  roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  myPlayerId = 0;
  isOnline = true;

  const myName = playerNameInput.value.trim() || 'Hôte';
  const maxPlayers = parseInt(selectMaxPlayers.value);
  let initialPlayers = [];
  for (let i = 0; i < maxPlayers; i++) {
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
    unoVulnerablePlayer: null,
    drawPenalty: 0 // On initialise la pénalité
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
      
      const myName = playerNameInput.value.trim() || `Joueur ${myPlayerId + 1}`;
      data.players[myPlayerId].joined = true;
      data.players[myPlayerId].name = myName;

      update(ref(window.db, 'rooms/' + roomCode), { players: data.players });

      lobbyControls.classList.add('hidden');
      roomInfo.classList.remove('hidden');
      displayRoomCode.textContent = roomCode;
      if (data.players.every(p => p.joined)) {
        elTurnIndicator.textContent = "Connecté ! L'hôte lance la partie...";
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
    unoVulnerablePlayer: unoVulnerablePlayer,
    drawPenalty: drawPenalty
  });
}

function syncGameState(data) {
  // 1. Détection des changements AVANT de mettre à jour le jeu
  const oldDiscardLength = discardPile.length;
  const newDiscardLength = data.discardPile ? data.discardPile.length : 0;
  
  let opponentWhoPlayed = -1;
  let cardPlayedByOpponent = null;
  let opponentWhoDrew = -1;
  let cardsDrawn = 0;

  // On compare les cartes pour savoir qui a joué ou pioché
  for (let i = 0; i < data.players.length; i++) {
    const oldHandSize = (players[i] && players[i].hand) ? players[i].hand.length : 0;
    const newHandSize = (data.players[i] && data.players[i].hand) ? data.players[i].hand.length : 0;
    
    if (newHandSize < oldHandSize && i !== myPlayerId) {
      opponentWhoPlayed = i;
      cardPlayedByOpponent = data.discardPile[data.discardPile.length - 1];
    } else if (newHandSize > oldHandSize && i !== myPlayerId) {
      opponentWhoDrew = i;
      cardsDrawn = newHandSize - oldHandSize;
    }
  }

  // 2. Mise à jour des variables de jeu
  gameStatus = data.status || 'waiting';
  activePlayerIndex = data.activePlayerIndex;
  playDirection = data.playDirection;
  currentColor = data.currentColor;
  deck = data.deck || [];
  discardPile = data.discardPile || [];
  players = data.players || [];
  winner = data.winner !== undefined ? data.winner : null;
  unoVulnerablePlayer = data.unoVulnerablePlayer !== undefined ? data.unoVulnerablePlayer : null;
  drawPenalty = data.drawPenalty || 0;

  // 3. On affiche la table mise à jour
  renderTable();

  // 4. ANIMATION : Si un adversaire a JOUÉ une carte
  if (opponentWhoPlayed !== -1 && cardPlayedByOpponent) {
    const fromEl = document.getElementById(`opponent-zone-${opponentWhoPlayed}`);
    const toEl = document.getElementById('discard-pile');
    if (fromEl && toEl) {
      // On cache la carte posée le temps que l'animation de vol se fasse
      const topCardEl = toEl.lastChild;
      if (topCardEl) topCardEl.style.opacity = '0'; 

      animateCardFlight(fromEl, toEl, cardPlayedByOpponent, () => {
        if (topCardEl) topCardEl.style.opacity = '1'; // On la fait réapparaître
      });
    }
  }

  // 5. ANIMATION : Si un adversaire a PIOCHÉ des cartes
  if (opponentWhoDrew !== -1) {
    const toEl = document.getElementById(`opponent-zone-${opponentWhoDrew}`);
    const fromEl = document.getElementById('draw-pile');
    if (fromEl && toEl) {
      // S'il pioche plusieurs cartes (ex: +2, +4), on les anime une par une
      for(let k = 0; k < cardsDrawn; k++) {
        setTimeout(() => {
          animateCardFlight(fromEl, toEl, {color: 'back', value: ''});
        }, k * 150); // Décalage de 150ms entre chaque carte
      }
    }
  }

  // 6. Mise à jour du texte du tour
  if (gameStatus === 'playing') {
    const currentPlayer = players[activePlayerIndex];
    let penText = '';
    
    if (drawPenalty > 0 && discardPile.length > 0) {
      const topCard = discardPile[discardPile.length - 1];
      const typeRequis = topCard.value === '+4' ? '+4' : '+2';
      penText = `<br><span style="color:#e74c3c; font-size:16px;">⚠️ PÉNALITÉ : +${drawPenalty} (Joue un ${typeRequis} ou pioche)</span>`;
    }
    
    if (activePlayerIndex === myPlayerId) {
      elTurnIndicator.innerHTML = `<span style="color: #2ecc71;">C'est à TON tour !</span> (Couleur : ${getFrenchColor(currentColor)})${penText}`;
    } else {
      elTurnIndicator.innerHTML = `Au tour de ${currentPlayer.name} (Couleur : ${getFrenchColor(currentColor)})${penText}`;
    }
  }
}

// Logique de Jeu UNO
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
      newCard.isNew = true; 
      player.hand.push(newCard);
    }
  }
}

function isPlayable(card) {
  const topCard = discardPile[discardPile.length - 1];

  // RÈGLE STRICTE : Si une pénalité est active, on doit répondre avec le même type de carte
  if (drawPenalty > 0) {
    if (topCard.value === '+2') return card.value === '+2';
    if (topCard.value === '+4') return card.value === '+4';
  }
  
  if (card.color === 'black') return true;
  if (card.color === currentColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function startOnlineGameFromFirebase(currentPlayersData) {
  createDeck();
  discardPile = [];
  playDirection = 1;
  
  // NOUVEAU : On choisit un joueur au hasard pour commencer !
  activePlayerIndex = Math.floor(Math.random() * currentPlayersData.length);
  
  gameStatus = 'playing';
  winner = null;
  unoVulnerablePlayer = null;
  actionLocked = false;
  drawPenalty = 0;

  players = currentPlayersData;
  players.forEach(p => { p.hand = []; });
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
    document.getElementById('win-text').innerHTML = `🎉 ${players[winner].name} a gagné ! 🎉`;
    winScreen.classList.remove('hidden');
    btnUno.style.display = 'none';
    btnContre.style.display = 'none';
    return;
  } else {
    winScreen.classList.add('hidden');
  }

  // BOUTONS UNO ALÉATOIRES
  if (unoVulnerablePlayer !== null) {
    if (unoVulnerablePlayer === myPlayerId) {
      btnUno.style.display = 'block';
      btnContre.style.display = 'none';
      if (btnUno.dataset.active !== "true") {
        btnUno.style.bottom = 'auto'; // Retire l'ancrage en bas du CSS
        btnUno.style.transform = 'none'; // Retire le centrage du CSS
        btnUno.style.left = Math.floor(Math.random() * 50 + 20) + 'vw';
        btnUno.style.top = Math.floor(Math.random() * 50 + 20) + 'vh';
        btnUno.dataset.active = "true";
      }
    } else {
      btnUno.style.display = 'none';
      btnContre.style.display = 'block';
      if (btnContre.dataset.active !== "true") {
        btnContre.style.left = Math.floor(Math.random() * 50 + 20) + 'vw';
        btnContre.style.top = Math.floor(Math.random() * 50 + 20) + 'vh';
        btnContre.dataset.active = "true";
      }
    }
  } else {
    btnUno.style.display = 'none';
    btnContre.style.display = 'none';
    btnUno.dataset.active = "false";
    btnContre.dataset.active = "false";
  }

  if (discardPile.length === 0) return;
  const topCard = discardPile[discardPile.length - 1];
  
  elDiscardPile.innerHTML = '';
  const cardEl = document.createElement('div');
  cardEl.className = `card ${currentColor === 'black' ? topCard.color : currentColor}`;
  cardEl.innerHTML = `<span>${topCard.value}</span>`;
  elDiscardPile.appendChild(cardEl);

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
    oppZone.id = `opponent-zone-${oppIndex}`;     
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
        handEl.appendChild(cEl);
      });
    }
    
    oppZone.appendChild(nameEl);
    oppZone.appendChild(handEl);
    elOpponents.appendChild(oppZone);
  }

  const myPlayer = players[myPlayerId];
  if (!myPlayer || !myPlayer.hand) return;

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

// Fonction d'Animation (100% gérée en JS, sans CSS !)
function animateCardFlight(fromElement, toElement, cardData, onComplete) {
  if (!fromElement || !toElement) {
    if (onComplete) onComplete();
    return;
  }

  // On calcule les coordonnées de départ et d'arrivée
  const startRect = fromElement.getBoundingClientRect();
  const endRect = toElement.getBoundingClientRect();

  const dx = startRect.left - endRect.left;
  const dy = startRect.top - endRect.top;

  // On crée la carte volante
  const flyer = document.createElement('div');
  flyer.className = `card ${cardData.color === 'black' ? 'black' : cardData.color}`;
  if (cardData.color === 'back') {
    flyer.className = 'card back'; // Pour l'animation de la pioche
  }
  flyer.innerHTML = cardData.value ? `<span>${cardData.value}</span>` : '';
  
  // On la place par-dessus tout le reste
  flyer.style.position = 'fixed';
  flyer.style.left = `${endRect.left}px`;
  flyer.style.top = `${endRect.top}px`;
  flyer.style.zIndex = '9999';
  flyer.style.pointerEvents = 'none'; // Pour ne pas bloquer les clics
  flyer.style.margin = '0';

  document.body.appendChild(flyer);

  // On lance l'animation native du navigateur (Web Animations API)
  const animation = flyer.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(1)` }, // Point de départ
    { transform: `translate(0px, 0px) scale(1)` }          // Point d'arrivée
  ], {
    duration: 400, // 400 millisecondes
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' // Courbe de vitesse fluide
  });

  // Quand l'animation est finie, on détruit la fausse carte et on valide le coup
  animation.onfinish = () => {
    flyer.remove();
    if (onComplete) onComplete();
  };
}

elDrawPile.addEventListener('click', () => {
  if (!isOnline || activePlayerIndex !== myPlayerId || actionLocked) return;

  actionLocked = true;
  const currentPlayer = players[myPlayerId];
  
  const deckEl = document.getElementById('draw-pile');
  const handEl = document.getElementById('active-hand');
  const dummyCard = { color: 'back', value: '' }; // Dos de carte visuel

  // Si on pioche sous la contrainte d'une pénalité, on pioche le montant accumulé
  let cardsToDraw = drawPenalty > 0 ? drawPenalty : 1;

  animateCardFlight(deckEl, handEl, dummyCard, () => {
    drawCard(currentPlayer, cardsToDraw);
    
    if (unoVulnerablePlayer === myPlayerId) {
      unoVulnerablePlayer = null;
    }

    if (drawPenalty > 0) {
      drawPenalty = 0; // On annule la pénalité puisqu'on vient de la manger
    }

    activePlayerIndex = (activePlayerIndex + playDirection + players.length) % players.length;
    updateFirebaseState();
    actionLocked = false;
  });
});

function playCard(cardIndex) {
  if (actionLocked) return;
  actionLocked = true;

  const currentPlayer = players[myPlayerId];
  const cardToPlay = currentPlayer.hand[cardIndex];

  const cardElements = document.querySelectorAll('#active-hand .card');
  const selectedCardEl = cardElements[cardIndex];
  const discardEl = document.getElementById('discard-pile');

  animateCardFlight(selectedCardEl, discardEl, cardToPlay, () => {
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
      actionLocked = false;
      return;
    }

    actionLocked = false;
    if (card.color === 'black') {
      colorPickerOverlay.classList.remove('hidden');
      window.pendingCardValue = card.value;
    } else {
      applySpecialEffects(card.value);
    }
  });
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
    drawPenalty += 2; 
  } else if (cardValue === '+4') {
    drawPenalty += 4; // NOUVEAU : Le +4 s'ajoute à la pénalité au lieu de skipper le tour
  }

  let steps = skipNext ? 2 : 1;
  activePlayerIndex = (activePlayerIndex + (playDirection * steps) + players.length) % players.length;

  updateFirebaseState();
}

function getFrenchColor(color) {
  const dict = { red: 'Rouge', blue: 'Bleu', green: 'Vert', yellow: 'Jaune', black: 'Couleur' };
  return dict[color] || color;
}
