import { useCallback, useEffect, useMemo, useState } from 'react'
import { GamepadIcon, RefreshIcon } from './Icons'
import type { BadgeDef } from '../lib/api'

interface GamesViewProps {
  onEarned: (badges: BadgeDef[]) => void
  onProgress: () => void
}

type GameKind = 'snake' | 'word-search' | 'color-blocks'
type Cell = { row: number; col: number }

const SNAKE_SIZE = 12
const WORD_GRID = ['MURIQZLP', 'ABCODERN', 'LEARNXOA', 'TQWERTYU', 'PLAYASDF', 'GROWGHJK', 'ZXCVBNMQ', 'POIUYTRE']
const WORDS = ['MURI', 'CODE', 'LEARN', 'PLAY', 'GROW']

function sameCell(a: Cell, b: Cell): boolean { return a.row === b.row && a.col === b.col }

function randomFood(snake: Cell[]): Cell {
  const open: Cell[] = []
  for (let row = 0; row < SNAKE_SIZE; row += 1) for (let col = 0; col < SNAKE_SIZE; col += 1) {
    if (!snake.some((cell) => cell.row === row && cell.col === col)) open.push({ row, col })
  }
  return open[Math.floor(Math.random() * open.length)] ?? { row: 5, col: 5 }
}

export default function GamesView({ onEarned: _onEarned, onProgress: _onProgress }: GamesViewProps) {
  const [game, setGame] = useState<GameKind>('snake')
  return (
    <div className="view-pad">
      <header className="view-head"><div><h2><GamepadIcon size={20} /> Games</h2><p className="muted">Choose a quick game and have fun while you learn.</p></div></header>
      <div className="game-tabs" role="tablist" aria-label="Games">
        <button className={game === 'snake' ? 'active' : ''} onClick={() => setGame('snake')} type="button">🐍 Snake</button>
        <button className={game === 'word-search' ? 'active' : ''} onClick={() => setGame('word-search')} type="button">🔎 Word Search</button>
        <button className={game === 'color-blocks' ? 'active' : ''} onClick={() => setGame('color-blocks')} type="button">🎨 Color Blocks</button>
      </div>
      {game === 'snake' && <SnakeGame />}
      {game === 'word-search' && <WordSearchGame />}
      {game === 'color-blocks' && <ColorBlocksGame />}
    </div>
  )
}

function SnakeGame() {
  const initialSnake = useMemo(() => [{ row: 6, col: 5 }, { row: 6, col: 4 }, { row: 6, col: 3 }], [])
  const [snake, setSnake] = useState<Cell[]>(initialSnake)
  const [food, setFood] = useState<Cell>({ row: 3, col: 8 })
  const [direction, setDirection] = useState<Cell>({ row: 0, col: 1 })
  const [running, setRunning] = useState(false)
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const reset = useCallback(() => { setSnake(initialSnake); setFood({ row: 3, col: 8 }); setDirection({ row: 0, col: 1 }); setScore(0); setGameOver(false); setRunning(true) }, [initialSnake])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const next: Record<string, Cell> = { ArrowUp: { row: -1, col: 0 }, ArrowDown: { row: 1, col: 0 }, ArrowLeft: { row: 0, col: -1 }, ArrowRight: { row: 0, col: 1 } }
      const requested = next[event.key]
      if (!requested) return
      event.preventDefault()
      setDirection((current) => current.row + requested.row === 0 && current.col + requested.col === 0 ? current : requested)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setSnake((current) => {
        const next = { row: current[0].row + direction.row, col: current[0].col + direction.col }
        if (next.row < 0 || next.row >= SNAKE_SIZE || next.col < 0 || next.col >= SNAKE_SIZE || current.some((cell) => sameCell(cell, next))) { setRunning(false); setGameOver(true); return current }
        const updated = [next, ...current]
        if (sameCell(next, food)) { setScore((value) => value + 1); setFood(randomFood(updated)); return updated }
        updated.pop(); return updated
      })
    }, 150)
    return () => window.clearInterval(timer)
  }, [direction, food, running])

  return (
    <section className="panel game-panel">
      <div className="game-panel-head"><div><h3>Snake</h3><p className="muted">Use the arrow keys to collect the fruit.</p></div><span className="pill">Score {score}</span></div>
      <div className="snake-board" style={{ gridTemplateColumns: `repeat(${SNAKE_SIZE}, 1fr)` }}>{Array.from({ length: SNAKE_SIZE * SNAKE_SIZE }, (_, index) => { const cell = { row: Math.floor(index / SNAKE_SIZE), col: index % SNAKE_SIZE }; const isHead = sameCell(cell, snake[0]); const isBody = snake.some((part) => sameCell(part, cell)); return <span className={`snake-cell ${isBody ? 'snake-body' : ''} ${isHead ? 'snake-head' : ''} ${sameCell(cell, food) ? 'snake-food' : ''}`} key={index} /> })}</div>
      <p className="game-status">{gameOver ? 'Game over — try to beat your score!' : running ? 'Playing…' : 'Ready when you are.'}</p>
      <button className="primary-btn" onClick={reset} type="button"><RefreshIcon size={16} /> {running ? 'Restart' : 'Start Snake'}</button>
    </section>
  )
}

function WordSearchGame() {
  const [found, setFound] = useState<string[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const letters = selected.map((index) => WORD_GRID[Math.floor(index / 8)][index % 8]).join('')
  function pick(index: number) {
    if (found.length === WORDS.length || selected.includes(index)) return
    const next = [...selected, index]
    const value = next.map((item) => WORD_GRID[Math.floor(item / 8)][item % 8]).join('')
    if (WORDS.includes(value) && !found.includes(value)) { setFound([...found, value]); setSelected([]) }
    else if (!WORDS.some((word) => word.startsWith(value))) setSelected([index])
    else setSelected(next)
  }
  return (
    <section className="panel game-panel">
      <div className="game-panel-head"><div><h3>Word Search</h3><p className="muted">Click letters in order to find each hidden word.</p></div><span className="pill">{found.length}/{WORDS.length} found</span></div>
      <div className="word-grid">{WORD_GRID.flatMap((row, rowIndex) => [...row].map((letter, colIndex) => { const index = rowIndex * 8 + colIndex; return <button className={`word-cell ${selected.includes(index) ? 'selected' : ''}`} key={index} onClick={() => pick(index)} type="button">{letter}</button> }))}</div>
      <div className="word-bank">{WORDS.map((word) => <span className={found.includes(word) ? 'word-found' : ''} key={word}>{found.includes(word) ? '✓ ' : ''}{word}</span>)}</div>
      <p className="game-status">{found.length === WORDS.length ? 'Great work — every word is found!' : letters ? `Selected: ${letters}` : 'Start with any letter.'}</p>
      <button className="secondary-btn" onClick={() => { setFound([]); setSelected([]) }} type="button"><RefreshIcon size={16} /> New search</button>
    </section>
  )
}

function ColorBlocksGame() {
  const [sequence, setSequence] = useState<number[]>([])
  const [showing, setShowing] = useState<number | null>(null)
  const [position, setPosition] = useState(0)
  const [score, setScore] = useState(0)
  const [started, setStarted] = useState(false)
  const [message, setMessage] = useState('Repeat the highlighted pattern.')
  const play = useCallback((next: number[]) => { setSequence(next); setPosition(0); setShowing(null); next.forEach((cell, index) => window.setTimeout(() => setShowing(cell), index * 520 + 250)); window.setTimeout(() => setShowing(null), next.length * 520 + 250) }, [])
  function start() { setScore(0); setStarted(true); setMessage('Watch the pattern…'); play([Math.floor(Math.random() * 16)]) }
  function choose(cell: number) {
    if (!started || showing !== null) return
    if (cell !== sequence[position]) { setMessage('Not quite — try a new pattern.'); setStarted(false); return }
    const nextPosition = position + 1
    if (nextPosition === sequence.length) { const nextScore = score + 1; setScore(nextScore); setMessage('Nice! Watch the next pattern…'); window.setTimeout(() => play([...sequence, Math.floor(Math.random() * 16)]), 450) } else setPosition(nextPosition)
  }
  return (
    <section className="panel game-panel">
      <div className="game-panel-head"><div><h3>Color Blocks</h3><p className="muted">Remember the pattern, then repeat it.</p></div><span className="pill">Round {score}</span></div>
      <div className="color-board">{Array.from({ length: 16 }, (_, cell) => <button className={`color-block color-${cell % 4} ${showing === cell ? 'lit' : ''}`} key={cell} onClick={() => choose(cell)} type="button" aria-label={`Color block ${cell + 1}`} />)}</div>
      <p className="game-status">{message}</p>
      <button className="primary-btn" onClick={start} type="button"><RefreshIcon size={16} /> {started ? 'Restart' : 'Start Color Blocks'}</button>
    </section>
  )
}
