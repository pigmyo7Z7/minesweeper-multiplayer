import { useState, useEffect, useRef } from 'react';
import { database } from './firebase';
import { ref, set, onValue, remove, get, update, runTransaction } from 'firebase/database';
import './App.css';

// 難易度（地雷密度）
const DIFFICULTY = {
  shiniri: { name: 'しんいり', icon: '🐣', density: 0.08 },
  hiyokko: { name: 'ひよっこ', icon: '🐥', density: 0.12 },
  sokosoko: { name: 'そこそこ', icon: '🐔', density: 0.16 },
  choimuzu: { name: 'ちょいむず', icon: '🔥', density: 0.20 },
  gekimuzu: { name: 'げきむず', icon: '💀', density: 0.25 }
};

// マス目サイズ（人数対応）
const BOARD_SIZE = {
  xs: { name: 'ちいさめ', rows: 9, cols: 9, players: '1-2人', shields: 1 },
  sm: { name: 'ふつう', rows: 12, cols: 12, players: '2-3人', shields: 1 },
  md: { name: 'おおきめ', rows: 16, cols: 16, players: '3-5人', shields: 2 },
  lg: { name: 'でかい', rows: 18, cols: 24, players: '4-6人', shields: 2 },
  xl: { name: 'ばかでか', rows: 20, cols: 30, players: '6-8人', shields: 3 },
  hell: { name: 'じごく', rows: 50, cols: 50, players: '8人+', shields: 10 }
};

// 8人分のカラーパレット
const PLAYER_COLORS = [
  '#3B82F6', '#EF4444', '#22C55E', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#F97316',
];

// 効果音を再生
const playBoomSound = () => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.setValueAtTime(200, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3);
  oscillator.frequency.exponentialRampToValueAtTime(150, audioContext.currentTime + 0.5);
  oscillator.frequency.exponentialRampToValueAtTime(30, audioContext.currentTime + 0.8);
  
  gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
  
  oscillator.type = 'sine';
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.8);

  setTimeout(() => {
    const osc2 = audioContext.createOscillator();
    const gain2 = audioContext.createGain();
    osc2.connect(gain2);
    gain2.connect(audioContext.destination);
    osc2.frequency.setValueAtTime(400, audioContext.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.4);
    gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
    osc2.type = 'triangle';
    osc2.start(audioContext.currentTime);
    osc2.stop(audioContext.currentTime + 0.4);
  }, 100);
};

// シールド取得音
const playShieldSound = () => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.frequency.setValueAtTime(523, audioContext.currentTime);
  oscillator.frequency.setValueAtTime(659, audioContext.currentTime + 0.1);
  oscillator.frequency.setValueAtTime(784, audioContext.currentTime + 0.2);
  
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
  
  oscillator.type = 'sine';
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.4);
};

// クリア時のファンファーレ音
const playWinSound = () => {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  
  // パンパカパーン！のメロディ
  const notes = [
    { freq: 523, time: 0, duration: 0.15 },      // ド
    { freq: 659, time: 0.15, duration: 0.15 },   // ミ
    { freq: 784, time: 0.3, duration: 0.15 },    // ソ
    { freq: 1047, time: 0.45, duration: 0.4 },   // 高いド（長め）
  ];
  
  notes.forEach(note => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    
    osc.frequency.setValueAtTime(note.freq, audioContext.currentTime + note.time);
    gain.gain.setValueAtTime(0.3, audioContext.currentTime + note.time);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + note.time + note.duration);
    
    osc.type = 'square';
    osc.start(audioContext.currentTime + note.time);
    osc.stop(audioContext.currentTime + note.time + note.duration);
  });
  
  // キラキラ音を追加
  setTimeout(() => {
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.setValueAtTime(1500 + Math.random() * 1000, audioContext.currentTime);
        gain.gain.setValueAtTime(0.1, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        osc.type = 'sine';
        osc.start(audioContext.currentTime);
        osc.stop(audioContext.currentTime + 0.1);
      }, i * 100);
    }
  }, 500);
};

function createBoard(boardSize, difficulty, safeRow = -1, safeCol = -1, shieldsEnabled = true) {
  const { rows, cols, shields } = BOARD_SIZE[boardSize];
  const { density } = DIFFICULTY[difficulty];
  const mines = Math.floor(rows * cols * density);
  
  const newBoard = Array(rows).fill(null).map((_, r) =>
    Array(cols).fill(null).map((_, c) => ({
      isMine: false,
      isShield: false,
      isRevealed: false,
      isFlagged: false,
      neighborMines: 0,
      revealedBy: null
    }))
  );

  // 地雷配置
  let placedMines = 0;
  while (placedMines < mines) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const isSafeZone = Math.abs(r - safeRow) <= 1 && Math.abs(c - safeCol) <= 1;
    
    if (!newBoard[r][c].isMine && !isSafeZone) {
      newBoard[r][c].isMine = true;
      placedMines++;
    }
  }

  // シールド配置（有効な場合のみ）
  if (shieldsEnabled) {
    let placedShields = 0;
    while (placedShields < shields) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      const isSafeZone = Math.abs(r - safeRow) <= 1 && Math.abs(c - safeCol) <= 1;
      
      if (!newBoard[r][c].isMine && !newBoard[r][c].isShield && !isSafeZone) {
        newBoard[r][c].isShield = true;
        placedShields++;
      }
    }
  }

  // 周囲の地雷数を計算
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!newBoard[r][c].isMine) {
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && newBoard[nr][nc].isMine) {
              count++;
            }
          }
        }
        newBoard[r][c].neighborMines = count;
      }
    }
  }

  return newBoard;
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function ExplosionEffect({ x, y, onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 1000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="explosion" style={{ left: x, top: y }}>
      {[...Array(12)].map((_, i) => (
        <div key={i} className="particle" style={{
          '--angle': `${i * 30}deg`,
          '--color': ['#FF6B6B', '#FFE66D', '#4ECDC4', '#FF8C42', '#A8E6CF'][i % 5]
        }} />
      ))}
      <div className="explosion-text">💥 ドカーン！</div>
    </div>
  );
}

// シールド発動中のエフェクト（縁の光だけ）
function ShieldActiveEffect() {
  return (
    <div className="shield-active-overlay">
      <div className="shield-border-glow"></div>
    </div>
  );
}

// クリア時の紙吹雪エフェクト
function ConfettiEffect() {
  const colors = ['#FF6B6B', '#FFE66D', '#4ECDC4', '#45B7D1', '#96E6A1', '#DDA0DD', '#F8B500'];
  const confetti = [...Array(50)].map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 2 + Math.random() * 2,
    color: colors[i % colors.length],
    size: 8 + Math.random() * 8,
    rotation: Math.random() * 360
  }));

  return (
    <div className="confetti-container">
      {confetti.map(c => (
        <div
          key={c.id}
          className="confetti"
          style={{
            left: `${c.left}%`,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
            backgroundColor: c.color,
            width: `${c.size}px`,
            height: `${c.size}px`,
            transform: `rotate(${c.rotation}deg)`
          }}
        />
      ))}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('lobby');
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [players, setPlayers] = useState({});
  const [board, setBoard] = useState(null);
  const [gameState, setGameState] = useState('waiting');
  const [difficulty, setDifficulty] = useState('sokosoko');
  const [boardSize, setBoardSize] = useState('sm');
  const [isHost, setIsHost] = useState(false);
  const [firstClick, setFirstClick] = useState(true);
  const [lives, setLives] = useState(1);
  const [maxLives, setMaxLives] = useState(1);
  const [shieldsEnabled, setShieldsEnabled] = useState(true);
  const [playerShields, setPlayerShields] = useState({});
  const [explosions, setExplosions] = useState([]);
  const [lastTriggeredBy, setLastTriggeredBy] = useState(null);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const boardRef = useRef(null);
  const prevGameStateRef = useRef(gameState);

  const sizeConfig = BOARD_SIZE[boardSize];
  const myShieldCount = playerShields[playerName] || 0;

  // 地雷踏んだときの効果音
  const handleMineHit = () => {
    playBoomSound();
    if (boardRef.current) {
      const rect = boardRef.current.getBoundingClientRect();
      const newExplosions = [...Array(3)].map((_, i) => ({
        id: Date.now() + i,
        x: Math.random() * rect.width,
        y: Math.random() * rect.height
      }));
      setExplosions(prev => [...prev, ...newExplosions]);
    }
  };

  // クリア時の効果音とエフェクト
  useEffect(() => {
    if (prevGameStateRef.current !== 'won' && gameState === 'won') {
      playWinSound();
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    }
    prevGameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    if (!roomId) return;

    const roomRef = ref(database, `rooms/${roomId}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.players) setPlayers(data.players);
        if (data.board) setBoard(data.board);
        if (data.gameState) setGameState(data.gameState);
        if (data.difficulty) setDifficulty(data.difficulty);
        if (data.boardSize) setBoardSize(data.boardSize);
        if (data.firstClick !== undefined) setFirstClick(data.firstClick);
        if (data.lives !== undefined) setLives(data.lives);
        if (data.maxLives !== undefined) setMaxLives(data.maxLives);
        if (data.shieldsEnabled !== undefined) setShieldsEnabled(data.shieldsEnabled);
        if (data.playerShields !== undefined) setPlayerShields(data.playerShields || {});
        if (data.lastTriggeredBy !== undefined) setLastTriggeredBy(data.lastTriggeredBy);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  const getPlayerColor = (existingPlayers) => {
    const usedColors = Object.values(existingPlayers || {}).map(p => p.color);
    return PLAYER_COLORS.find(c => !usedColors.includes(c)) || PLAYER_COLORS[0];
  };

  const createRoom = async () => {
    if (!playerName.trim()) {
      alert('名前を入力してね！');
      return;
    }

    const newRoomId = generateRoomId();
    const roomRef = ref(database, `rooms/${newRoomId}`);
    
    await set(roomRef, {
      players: {
        [playerName]: { name: playerName, color: PLAYER_COLORS[0], isHost: true }
      },
      board: null,
      gameState: 'waiting',
      difficulty: 'sokosoko',
      boardSize: 'sm',
      firstClick: true,
      lives: 1,
      maxLives: 1,
      shieldsEnabled: true,
      playerShields: {},
      lastTriggeredBy: null,
      createdAt: Date.now()
    });

    setRoomId(newRoomId);
    setIsHost(true);
    setScreen('game');
  };

  const joinRoom = async () => {
    if (!playerName.trim()) {
      alert('名前を入力してね！');
      return;
    }
    if (!inputRoomId.trim()) {
      alert('ルームIDを入力してね！');
      return;
    }

    const roomRef = ref(database, `rooms/${inputRoomId.toUpperCase()}`);
    const snapshot = await get(roomRef);
    
    if (!snapshot.exists()) {
      alert('ルームが見つからない…');
      return;
    }

    const roomData = snapshot.val();
    const playerColor = getPlayerColor(roomData.players);

    const playerRef = ref(database, `rooms/${inputRoomId.toUpperCase()}/players/${playerName}`);
    await set(playerRef, { name: playerName, color: playerColor, isHost: false });

    setRoomId(inputRoomId.toUpperCase());
    setIsHost(false);
    setScreen('game');
  };

  const startGame = async () => {
    const newBoard = createBoard(boardSize, difficulty, -1, -1, shieldsEnabled);
    
    // 全プレイヤーにシールド2を付与
    const initialShields = {};
    Object.keys(players).forEach(pName => {
      initialShields[pName] = 2;
    });
    
    await update(ref(database, `rooms/${roomId}`), {
      board: newBoard,
      gameState: 'playing',
      firstClick: true,
      lives: maxLives,
      playerShields: initialShields,
      lastTriggeredBy: null
    });
  };

  const revealCellRecursive = (board, row, col, rows, cols, pName, updates) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    const cell = board[row][col];
    if (cell.isRevealed || cell.isFlagged) return;

    cell.isRevealed = true;
    cell.revealedBy = pName;
    updates[`${row}_${col}`] = cell;

    // シールドマスは開くけど連鎖は止まる、地雷も連鎖しない
    if (cell.neighborMines === 0 && !cell.isMine && !cell.isShield) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          revealCellRecursive(board, row + dr, col + dc, rows, cols, pName, updates);
        }
      }
    }
  };

  const checkWin = (board) => {
    for (const row of board) {
      for (const cell of row) {
        // 地雷でないマスが未開示なら未クリア
        if (!cell.isMine && !cell.isRevealed) return false;
      }
    }
    return true;
  };

  const handleClick = async (row, col) => {
    if (gameState !== 'playing' || !board) return;

    // クリック前の状態を保存
    const shieldCountBefore = playerShields[playerName] || 0;
    const prevLives = lives;

    const boardDbRef = ref(database, `rooms/${roomId}`);
    
    try {
      const result = await runTransaction(boardDbRef, (currentData) => {
        if (!currentData || currentData.gameState !== 'playing') return currentData;
        
        let currentBoard = currentData.board;
        const { rows, cols } = BOARD_SIZE[currentData.boardSize];
        
        if (currentData.firstClick) {
          currentBoard = createBoard(currentData.boardSize, currentData.difficulty, row, col, currentData.shieldsEnabled);
          currentData.firstClick = false;
        }

        const cell = currentBoard[row][col];
        
        // 既に開いているシールドで未取得の場合は取得可能
        if (cell.isRevealed && cell.isShield && !cell.shieldCollected) {
          currentData.playerShields = currentData.playerShields || {};
          let currentShieldCount = currentData.playerShields[playerName] || 0;
          currentData.playerShields[playerName] = currentShieldCount + 1;
          cell.shieldCollected = true;
          cell.collectedBy = playerName; // 誰が取得したか記録
          currentData.board = currentBoard;
          return currentData;
        }
        
        if (cell.isRevealed || cell.isFlagged) return currentData;

        // プレイヤーのシールド数を取得
        currentData.playerShields = currentData.playerShields || {};
        let currentShieldCount = currentData.playerShields[playerName] || 0;

        // シールドアイテムを直接クリック → 開くだけで取得しない（次クリックで取得）
        if (cell.isShield && !cell.isMine) {
          cell.isRevealed = true;
          cell.revealedBy = playerName;
          // shieldCollectedはfalseのまま（取得していない）
          currentData.board = currentBoard;
          return currentData;
        }

        // 地雷を踏んだ
        if (cell.isMine) {
          if (currentShieldCount > 0) {
            // シールドで無効化（ここでシールド消費）
            currentData.playerShields[playerName] = currentShieldCount - 1;
            cell.isRevealed = true;
            cell.revealedBy = playerName;
            cell.shieldUsed = true;
            currentData.board = currentBoard;
            return currentData;
          } else {
            // シールドなしで地雷
            const newLives = currentData.lives - 1;
            currentData.lives = newLives;
            currentData.lastTriggeredBy = playerName;
            
            cell.isRevealed = true;
            cell.revealedBy = playerName;
            
            if (newLives <= 0) {
              currentBoard.forEach(r => r.forEach(c => {
                if (c.isMine) c.isRevealed = true;
              }));
              currentData.gameState = 'lost';
            }
            currentData.board = currentBoard;
            return currentData;
          }
        }

        // 通常のセルを開く
        const updates = {};
        revealCellRecursive(currentBoard, row, col, rows, cols, playerName, updates);
        currentData.board = currentBoard;

        if (checkWin(currentBoard)) {
          currentData.gameState = 'won';
        }
        
        return currentData;
      });

      // トランザクション成功後の効果音処理
      if (result.committed && result.snapshot.val()) {
        const data = result.snapshot.val();
        const cell = data.board?.[row]?.[col];
        const shieldCountAfter = data.playerShields?.[playerName] || 0;
        
        // シールドを取得した場合（シールドマスをクリック）
        if (cell?.shieldCollected && cell?.isRevealed) {
          playShieldSound();
        }
        // シールドで地雷を防いだ場合
        else if (cell?.shieldUsed && cell?.isRevealed) {
          playShieldSound();
        }
        // 地雷を踏んだ場合（残機が減った）
        else if (cell?.isMine && cell?.isRevealed && !cell?.shieldUsed && data.lives < prevLives) {
          handleMineHit();
        }
      }
    } catch (error) {
      console.error('Transaction failed:', error);
    }
  };

  const handleRightClick = async (e, row, col) => {
    e.preventDefault();
    if (gameState !== 'playing' || !board) return;

    const cell = board[row][col];
    if (cell.isRevealed) return;

    const cellRef = ref(database, `rooms/${roomId}/board/${row}/${col}`);
    await runTransaction(cellRef, (currentCell) => {
      if (!currentCell || currentCell.isRevealed) return currentCell;
      currentCell.isFlagged = !currentCell.isFlagged;
      currentCell.flaggedBy = currentCell.isFlagged ? playerName : null;
      return currentCell;
    });
  };

  const changeDifficulty = async (newDiff) => {
    if (!isHost || gameState === 'playing') return;
    await set(ref(database, `rooms/${roomId}/difficulty`), newDiff);
  };

  const changeBoardSize = async (newSize) => {
    if (!isHost || gameState === 'playing') return;
    await set(ref(database, `rooms/${roomId}/boardSize`), newSize);
  };

  const changeMaxLives = async (newLives) => {
    if (!isHost || gameState === 'playing') return;
    await update(ref(database, `rooms/${roomId}`), {
      maxLives: newLives,
      lives: newLives
    });
  };

  const toggleShields = async () => {
    if (!isHost || gameState === 'playing') return;
    await set(ref(database, `rooms/${roomId}/shieldsEnabled`), !shieldsEnabled);
  };

  const resetGame = async () => {
    if (!window.confirm('リセットしますか？')) return;
    await doReset();
  };

  const doReset = async () => {
    await update(ref(database, `rooms/${roomId}`), {
      board: null,
      gameState: 'waiting',
      firstClick: true,
      lives: maxLives,
      playerShields: {},
      lastTriggeredBy: null
    });
    setExplosions([]);
  };

  const leaveRoom = async () => {
    if (!window.confirm('退出しますか？')) return;
    
    if (roomId && playerName) {
      await remove(ref(database, `rooms/${roomId}/players/${playerName}`));
    }
    setRoomId('');
    setScreen('lobby');
    setIsHost(false);
    setBoard(null);
    setGameState('waiting');
    setExplosions([]);
  };

  const getCellContent = (cell) => {
    if (cell.isFlagged) return '🚩';
    if (!cell.isRevealed) return '';
    if (cell.isMine) return '💣';
    if (cell.isShield && !cell.shieldCollected) return '🛡️'; // 未取得シールド
    // 取得済みシールドは周囲の爆弾数を表示
    if (cell.isShield && cell.shieldCollected) {
      if (cell.neighborMines === 0) return '';
      return cell.neighborMines;
    }
    if (cell.neighborMines === 0) return '';
    return cell.neighborMines;
  };

  const getCellClass = (cell) => {
    let base = 'cell';
    if (!cell.isRevealed) {
      base += ' cell-hidden';
    } else if (cell.isMine && !cell.shieldUsed) {
      base += ' cell-mine';
    } else if (cell.shieldUsed) {
      base += ' cell-shield';
    } else if (cell.isShield && cell.shieldCollected) {
      base += ' cell-revealed';
      if (cell.neighborMines > 0) {
        base += ` cell-${cell.neighborMines}`;
      }
    } else {
      base += ' cell-revealed';
      if (cell.neighborMines > 0) {
        base += ` cell-${cell.neighborMines}`;
      }
    }
    return base;
  };

  const getCellStyle = (cell) => {
    // 旗が立っている場合、旗を立てた人の色
    if (cell.isFlagged && cell.flaggedBy && players[cell.flaggedBy]) {
      return { 
        boxShadow: `inset 0 0 0 3px ${players[cell.flaggedBy].color}`,
        background: `${players[cell.flaggedBy].color}30`
      };
    }
    // 未取得シールドは開いた人の色
    if (cell.isRevealed && cell.isShield && !cell.shieldCollected && cell.revealedBy && players[cell.revealedBy]) {
      return { 
        boxShadow: `inset 0 0 0 3px ${players[cell.revealedBy].color}`,
        background: `${players[cell.revealedBy].color}30`
      };
    }
    // 取得済みシールドは取得した人の色
    if (cell.isRevealed && cell.isShield && cell.shieldCollected && cell.collectedBy && players[cell.collectedBy]) {
      return { 
        boxShadow: `inset 0 0 0 2px ${players[cell.collectedBy].color}` 
      };
    }
    // 通常の開いたマス
    if (cell.isRevealed && cell.revealedBy && players[cell.revealedBy]) {
      return { 
        boxShadow: `inset 0 0 0 2px ${players[cell.revealedBy].color}` 
      };
    }
    return {};
  };

  const removeExplosion = (id) => {
    setExplosions(prev => prev.filter(e => e.id !== id));
  };

  const flagCount = board ? board.flat().filter(c => c.isFlagged).length : 0;
  const mineCount = board ? board.flat().filter(c => c.isMine).length : 0;

  if (screen === 'lobby') {
    return (
      <div className="lobby">
        <h1>💣 マインスイーパー</h1>
        <p className="subtitle">🎮 みんなで楽しくマルチプレイ 🎉</p>
        
        <div className="lobby-form">
          <input
            type="text"
            placeholder="あなたの名前"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={10}
          />

          <div className="divider-line"></div>

          <input
            type="text"
            placeholder="ルームID"
            value={inputRoomId}
            onChange={(e) => setInputRoomId(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <button onClick={joinRoom} className="btn-secondary">
            ルームに参加
          </button>

          <div className="divider">または</div>

          <button onClick={createRoom} className="btn-primary">
            ルームを作成
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-container">
      {/* シールド発動中のエフェクト */}
      {myShieldCount > 0 && gameState === 'playing' && <ShieldActiveEffect />}

      {/* クリア時の紙吹雪エフェクト */}
      {showConfetti && <ConfettiEffect />}

      {/* コピー通知 */}
      {showCopyToast && <div className="copy-toast">コピーしました！</div>}

      <div className="game-header">
        <h1>💣 マインスイーパー</h1>
        <div className="room-info">
          ルームID: <span className="room-id">{roomId}</span>
          <button onClick={() => {
            navigator.clipboard.writeText(roomId);
            setShowCopyToast(true);
            setTimeout(() => setShowCopyToast(false), 1500);
          }} className="btn-small" title="コピー">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="players-list">
        {Object.values(players).map((p) => (
          <div 
            key={p.name} 
            className={`player-tag ${(playerShields[p.name] || 0) > 0 ? 'shield-active' : ''}`}
            style={{ backgroundColor: p.color }}
          >
            {p.name} {p.isHost && '👑'}
            {(playerShields[p.name] || 0) > 0 && ` 🛡️×${playerShields[p.name]}`}
          </div>
        ))}
      </div>

      {gameState === 'waiting' && (
        <div className="waiting-room">
          <p>プレイヤーを待っています...</p>
          
          {isHost && (
            <>
              <div className="setting-section">
                <label className="setting-label">難易度</label>
                <div className="difficulty-select">
                  {Object.entries(DIFFICULTY).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => changeDifficulty(key)}
                      className={`btn-diff ${difficulty === key ? 'active' : ''}`}
                    >
                      {val.icon} {val.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-section">
                <label className="setting-label">マップサイズ</label>
                <div className="size-select">
                  {Object.entries(BOARD_SIZE).map(([key, val]) => (
                    <button
                      key={key}
                      onClick={() => changeBoardSize(key)}
                      className={`btn-size ${boardSize === key ? 'active' : ''}`}
                    >
                      {val.name}
                      <span className="size-info">{val.rows}×{val.cols} ({val.players})</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-row">
                <div className="setting-item">
                  <label>❤️ 残機: </label>
                  <select 
                    value={maxLives} 
                    onChange={(e) => changeMaxLives(Number(e.target.value))}
                    className="setting-select"
                  >
                    {[1, 2, 3, 5, 10, 99].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                <div className="setting-item">
                  <label>🛡️ 無敵アイテム: </label>
                  <button 
                    onClick={toggleShields}
                    className={`btn-toggle ${shieldsEnabled ? 'on' : 'off'}`}
                  >
                    {shieldsEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </div>

              <button onClick={startGame} className="btn-start">
                ゲーム開始！
              </button>
            </>
          )}
          
          {!isHost && (
            <div className="waiting-info">
              <p className="waiting-text">ホストがゲームを開始するのを待っています...</p>
              <p className="settings-preview">
                難易度: {DIFFICULTY[difficulty]?.icon} {DIFFICULTY[difficulty]?.name} ｜
                サイズ: {BOARD_SIZE[boardSize]?.name} ｜
                残機: {maxLives} ｜
                シールド: {shieldsEnabled ? 'ON' : 'OFF'}
              </p>
            </div>
          )}
        </div>
      )}

      {board && gameState !== 'waiting' && (
        <>
          <div className="game-stats">
            <div>💣 {mineCount - flagCount}</div>
            <div>🚩 {flagCount}</div>
            <div>❤️ {lives}/{maxLives}</div>
            {shieldsEnabled && <div className={myShieldCount > 0 ? 'shield-status' : ''}>🛡️ {myShieldCount}</div>}
            <button onClick={resetGame} className="btn-reset-small">🔄</button>
          </div>

          {(gameState === 'won' || gameState === 'lost') && (
            <div className={`game-result ${gameState}`}>
              {gameState === 'won' ? '🎉 クリア！' : (
                <>
                  💥 ゲームオーバー
                  {lastTriggeredBy && <div className="triggered-by">({lastTriggeredBy}がやらかした！)</div>}
                </>
              )}
            </div>
          )}

          <div className="board-container" ref={boardRef}>
            <div 
              className="board"
              style={{ 
                gridTemplateColumns: `repeat(${sizeConfig.cols}, 28px)`,
                gridTemplateRows: `repeat(${sizeConfig.rows}, 28px)`
              }}
            >
              {board.map((row, r) =>
                row.map((cell, c) => (
                  <div
                    key={`${r}-${c}`}
                    className={getCellClass(cell)}
                    style={getCellStyle(cell)}
                    onClick={() => handleClick(r, c)}
                    onContextMenu={(e) => handleRightClick(e, r, c)}
                  >
                    {getCellContent(cell)}
                  </div>
                ))
              )}
            </div>
            {explosions.map(exp => (
              <ExplosionEffect
                key={exp.id}
                x={exp.x}
                y={exp.y}
                onComplete={() => removeExplosion(exp.id)}
              />
            ))}
          </div>

          <div className="game-controls">
            {(gameState === 'won' || gameState === 'lost') && (
              <button onClick={doReset} className="btn-reset">
                🔄 リセット
              </button>
            )}
            <button onClick={leaveRoom} className="btn-leave">
              🚪 退出
            </button>
          </div>
        </>
      )}

      <div className="help-text">
        左クリック: 開く ｜ 右クリック: 旗
      </div>
      
      {shieldsEnabled && (
        <div className="item-info">
          <div className="item-info-title">🛡️ シールドについて</div>
          <div className="item-info-text">
            全員シールド2個持ちでスタート！地雷を踏むとシールドを1つ消費して無効化。
            マップ上のシールドは2回クリックで取得（1回目で発見、2回目で拾う）。
          </div>
        </div>
      )}
    </div>
  );
}
