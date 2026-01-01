import { useState, useEffect } from 'react';
import { database } from './firebase';
import { ref, set, onValue, remove, get } from 'firebase/database';
import './App.css';

const DIFFICULTY = {
  easy: { rows: 9, cols: 9, mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 }
};

function createBoard({ rows, cols, mines }, safeRow = -1, safeCol = -1) {
  const newBoard = Array(rows).fill(null).map((_, r) =>
    Array(cols).fill(null).map((_, c) => ({
      isMine: false,
      isRevealed: false,
      isFlagged: false,
      neighborMines: 0,
      revealedBy: null
    }))
  );

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

export default function App() {
  const [screen, setScreen] = useState('lobby');
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [players, setPlayers] = useState({});
  const [board, setBoard] = useState(null);
  const [gameState, setGameState] = useState('waiting');
  const [difficulty, setDifficulty] = useState('easy');
  const [isHost, setIsHost] = useState(false);
  const [firstClick, setFirstClick] = useState(true);

  const config = DIFFICULTY[difficulty];

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
        if (data.firstClick !== undefined) setFirstClick(data.firstClick);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  const createRoom = async () => {
    if (!playerName.trim()) {
      alert('名前を入力してね！');
      return;
    }

    const newRoomId = generateRoomId();
    const roomRef = ref(database, `rooms/${newRoomId}`);
    
    await set(roomRef, {
      players: {
        [playerName]: { name: playerName, color: '#3B82F6', isHost: true }
      },
      board: null,
      gameState: 'waiting',
      difficulty: 'easy',
      firstClick: true,
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

    const playerRef = ref(database, `rooms/${inputRoomId.toUpperCase()}/players/${playerName}`);
    await set(playerRef, { name: playerName, color: '#EF4444', isHost: false });

    setRoomId(inputRoomId.toUpperCase());
    setIsHost(false);
    setScreen('game');
  };

  const startGame = async () => {
    const newBoard = createBoard(DIFFICULTY[difficulty]);
    await set(ref(database, `rooms/${roomId}/board`), newBoard);
    await set(ref(database, `rooms/${roomId}/gameState`), 'playing');
    await set(ref(database, `rooms/${roomId}/firstClick`), true);
  };

  const revealCellRecursive = (board, row, col, rows, cols, pName) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    const cell = board[row][col];
    if (cell.isRevealed || cell.isFlagged) return;

    cell.isRevealed = true;
    cell.revealedBy = pName;

    if (cell.neighborMines === 0 && !cell.isMine) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          revealCellRecursive(board, row + dr, col + dc, rows, cols, pName);
        }
      }
    }
  };

  const checkWin = (board) => {
    for (const row of board) {
      for (const cell of row) {
        if (!cell.isMine && !cell.isRevealed) return false;
      }
    }
    return true;
  };

  const handleClick = async (row, col) => {
    if (gameState !== 'playing' || !board) return;

    let currentBoard = JSON.parse(JSON.stringify(board));
    
    if (firstClick) {
      currentBoard = createBoard(config, row, col);
      await set(ref(database, `rooms/${roomId}/firstClick`), false);
    }

    const cell = currentBoard[row][col];
    if (cell.isRevealed || cell.isFlagged) return;

    if (cell.isMine) {
      currentBoard.forEach(r => r.forEach(c => {
        if (c.isMine) c.isRevealed = true;
      }));
      await set(ref(database, `rooms/${roomId}/board`), currentBoard);
      await set(ref(database, `rooms/${roomId}/gameState`), 'lost');
      return;
    }

    revealCellRecursive(currentBoard, row, col, config.rows, config.cols, playerName);
    await set(ref(database, `rooms/${roomId}/board`), currentBoard);

    if (checkWin(currentBoard)) {
      await set(ref(database, `rooms/${roomId}/gameState`), 'won');
    }
  };

  const handleRightClick = async (e, row, col) => {
    e.preventDefault();
    if (gameState !== 'playing' || !board) return;

    const cell = board[row][col];
    if (cell.isRevealed) return;

    const newBoard = JSON.parse(JSON.stringify(board));
    newBoard[row][col].isFlagged = !newBoard[row][col].isFlagged;
    await set(ref(database, `rooms/${roomId}/board`), newBoard);
  };

  const changeDifficulty = async (newDiff) => {
    if (!isHost || gameState === 'playing') return;
    await set(ref(database, `rooms/${roomId}/difficulty`), newDiff);
  };

  const resetGame = async () => {
    await set(ref(database, `rooms/${roomId}/board`), null);
    await set(ref(database, `rooms/${roomId}/gameState`), 'waiting');
    await set(ref(database, `rooms/${roomId}/firstClick`), true);
  };

  const leaveRoom = async () => {
    if (roomId && playerName) {
      await remove(ref(database, `rooms/${roomId}/players/${playerName}`));
    }
    setRoomId('');
    setScreen('lobby');
    setIsHost(false);
    setBoard(null);
    setGameState('waiting');
  };

  const getCellContent = (cell) => {
    if (cell.isFlagged) return '🚩';
    if (!cell.isRevealed) return '';
    if (cell.isMine) return '💣';
    if (cell.neighborMines === 0) return '';
    return cell.neighborMines;
  };

  const getCellClass = (cell) => {
    let base = 'cell';
    if (!cell.isRevealed) {
      base += ' cell-hidden';
    } else if (cell.isMine) {
      base += ' cell-mine';
    } else {
      base += ' cell-revealed';
      if (cell.neighborMines > 0) {
        base += ` cell-${cell.neighborMines}`;
      }
    }
    return base;
  };

  const getCellStyle = (cell) => {
    if (cell.isRevealed && cell.revealedBy && players[cell.revealedBy]) {
      return { 
        boxShadow: `inset 0 0 0 2px ${players[cell.revealedBy].color}` 
      };
    }
    return {};
  };

  const flagCount = board ? board.flat().filter(c => c.isFlagged).length : 0;

  if (screen === 'lobby') {
    return (
      <div className="lobby">
        <h1>💣 マインスイーパー</h1>
        <p className="subtitle">マルチプレイ</p>
        
        <div className="lobby-form">
          <input
            type="text"
            placeholder="あなたの名前"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={10}
          />

          <button onClick={createRoom} className="btn-primary">
            ルームを作成
          </button>

          <div className="divider">または</div>

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
        </div>
      </div>
    );
  }

  return (
    <div className="game-container">
      <div className="game-header">
        <h1>💣 マインスイーパー</h1>
        <div className="room-info">
          ルームID: <span className="room-id">{roomId}</span>
          <button onClick={() => navigator.clipboard.writeText(roomId)} className="btn-small">
            📋
          </button>
        </div>
      </div>

      <div className="players-list">
        {Object.values(players).map((p) => (
          <div key={p.name} className="player-tag" style={{ backgroundColor: p.color }}>
            {p.name} {p.isHost && '👑'}
          </div>
        ))}
      </div>

      {gameState === 'waiting' && (
        <div className="waiting-room">
          <p>プレイヤーを待っています...</p>
          
          {isHost && (
            <>
              <div className="difficulty-select">
                {Object.keys(DIFFICULTY).map(level => (
                  <button
                    key={level}
                    onClick={() => changeDifficulty(level)}
                    className={`btn-diff ${difficulty === level ? 'active' : ''}`}
                  >
                    {level === 'easy' ? '初級' : level === 'medium' ? '中級' : '上級'}
                  </button>
                ))}
              </div>
              <button onClick={startGame} className="btn-start">
                ゲーム開始！
              </button>
            </>
          )}
          
          {!isHost && <p className="waiting-text">ホストがゲームを開始するのを待っています...</p>}
        </div>
      )}

      {board && gameState !== 'waiting' && (
        <>
          <div className="game-stats">
            <div>💣 {config.mines - flagCount}</div>
            <div>🚩 {flagCount}</div>
          </div>

          {(gameState === 'won' || gameState === 'lost') && (
            <div className={`game-result ${gameState}`}>
              {gameState === 'won' ? '🎉 クリア！' : '💥 ゲームオーバー'}
            </div>
          )}

          <div className="board-container">
            <div 
              className="board"
              style={{ 
                gridTemplateColumns: `repeat(${config.cols}, 28px)`,
                gridTemplateRows: `repeat(${config.rows}, 28px)`
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
          </div>

          <div className="game-controls">
            {isHost && (
              <button onClick={resetGame} className="btn-reset">
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
        左クリック: 開く ｜ 右クリック: 旗 ｜ 枠の色 = 開けた人
      </div>
    </div>
  );
}
