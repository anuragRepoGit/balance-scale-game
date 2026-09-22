import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import {
  Activity,
  ChevronRight,
  Copy,
  Crosshair,
  DoorOpen,
  Flame,
  LockKeyhole,
  LogOut,
  Radio,
  ShieldAlert,
  Skull,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react'
import { calculateRound } from './gameLogic'
import './App.css'

const ROUND_SECONDS = 30
const MAX_PLAYERS = 5
const hasSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
const supabase = hasSupabase
  ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  : null

const makeId = () => Math.random().toString(36).slice(2, 10)
const makeRoomCode = () => Math.floor(100000 + Math.random() * 900000).toString()
const randomGuess = () => Math.floor(Math.random() * 101)

function createPlayer(id, name) {
  return { id, name, points: 0, isLocked: false, currentGuess: null, isDead: false }
}

export default function App() {
  const [view, setView] = useState('lobby')
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [players, setPlayers] = useState([])
  const [hostId, setHostId] = useState('')
  const [round, setRound] = useState(1)
  const [phase, setPhase] = useState('lobby')
  const [seconds, setSeconds] = useState(ROUND_SECONDS)
  const [guess, setGuess] = useState(50)
  const [summary, setSummary] = useState(null)
  const [gameOver, setGameOver] = useState(false)
  const [revealChoices, setRevealChoices] = useState({})
  const [lockedLocally, setLockedLocally] = useState(false)
  const [error, setError] = useState('')
  const [playerId] = useState(makeId)
  const channelRef = useRef(null)
  const stateRef = useRef({})
  const pendingGuessRef = useRef(null)
  const calculatedRoundRef = useRef(null)

  const me = players.find((player) => player.id === playerId)
  const isHost = hostId === playerId
  const totalLocked = players.filter((player) => player.isLocked || player.isDead).length
  const activePlayers = useMemo(() => players.filter((player) => !player.isDead), [players])

  useEffect(() => {
    stateRef.current = { players, hostId, round, phase, seconds, revealChoices, summary }
  }, [players, hostId, round, phase, seconds, revealChoices, summary])

  useEffect(() => {
    if (!error) return undefined
    const timer = window.setTimeout(() => setError(''), 2600)
    return () => window.clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!roomCode || !supabase) return undefined

    const channel = supabase.channel(`room_${roomCode}`, {
      config: { broadcast: { self: true }, presence: { key: playerId } },
    })

    channel
      .on('broadcast', { event: 'player_joined' }, ({ payload }) => handlePlayerJoined(payload))
      .on('broadcast', { event: 'player_action' }, ({ payload }) => handlePlayerAction(payload))
      .on('broadcast', { event: 'round_reveal' }, ({ payload }) => handleRoundReveal(payload))
      .on('presence', { event: 'sync' }, () => handlePresenceSync(channel))
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return
        await channel.track({ id: playerId, name })
        broadcast('player_joined', {
          request: true,
          player: createPlayer(playerId, name),
        })
      })

    channelRef.current = channel
    return () => {
      channel.unsubscribe()
      channelRef.current = null
    }
  }, [roomCode, playerId])

  useEffect(() => {
    if (!isHost || view !== 'game' || phase !== 'lock') return undefined

    const timer = window.setInterval(() => {
      const nextSeconds = Math.max(0, stateRef.current.seconds - 1)
      setSeconds(nextSeconds)
      broadcast('player_action', { type: 'timer', seconds: nextSeconds, round: stateRef.current.round })
      if (nextSeconds === 0) {
        window.clearInterval(timer)
        revealRound('timer')
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [isHost, view, phase, round])

  useEffect(() => {
    if (!isHost || phase !== 'lock' || activePlayers.length === 0) return
    if (totalLocked === players.length) revealRound('all_locked')
  }, [isHost, phase, totalLocked, players.length, activePlayers.length])

  useEffect(() => {
    if (phase !== 'reveal' || activePlayers.length === 0) return
    const allChoicesCollected = activePlayers.every((player) => revealChoices[player.id] !== undefined)
    if (!allChoicesCollected || calculatedRoundRef.current === round) return
    calculatedRoundRef.current = round
    calculateAndApplyRound(revealChoices)
  }, [phase, revealChoices, activePlayers, round])

  function broadcast(event, payload) {
    channelRef.current?.send({ type: 'broadcast', event, payload })
  }

  function handlePlayerJoined(payload) {
    if (!payload?.player) return

    if (payload.roster) {
      setPlayers(payload.roster)
      if (payload.hostId) setHostId(payload.hostId)
      if (payload.phase) setPhase(payload.phase)
      if (typeof payload.seconds === 'number') setSeconds(payload.seconds)
      if (payload.round) setRound(payload.round)
    }

    setPlayers((current) => {
      if (current.some((player) => player.id === payload.player.id)) return current
      if (current.length >= MAX_PLAYERS) return current
      return [...current, payload.player]
    })

    if (isHost && payload.request) {
      broadcast('player_joined', {
        player: payload.player,
        roster: stateRef.current.players,
        hostId: playerId,
        phase: stateRef.current.phase,
        round: stateRef.current.round,
        seconds: stateRef.current.seconds,
      })
    }
  }

  function handlePlayerAction(payload) {
    if (!payload) return

    if (payload.type === 'game_started') {
      setPhase('lock')
      setView('game')
      setRound(payload.round)
      setSeconds(ROUND_SECONDS)
      setSummary(null)
      setRevealChoices({})
      setLockedLocally(false)
      calculatedRoundRef.current = null
      return
    }

    if (payload.type === 'lock' && payload.playerId) {
      setPlayers((current) => current.map((player) => (
        player.id === payload.playerId ? { ...player, isLocked: true } : player
      )))
      return
    }

    if (payload.type === 'timer' && payload.round === stateRef.current.round) {
      setSeconds(payload.seconds)
      return
    }

    if (payload.type === 'next_round') {
      setRound(payload.round)
      setPhase('lock')
      setSeconds(ROUND_SECONDS)
      setSummary(null)
      setRevealChoices({})
      setLockedLocally(false)
      calculatedRoundRef.current = null
      return
    }

    if (payload.type === 'leave' && payload.playerId) {
      setPlayers((current) => current.filter((player) => player.id !== payload.playerId))
      return
    }

    if (payload.type === 'reveal_choice' && payload.playerId && typeof payload.value === 'number') {
      setRevealChoices((current) => ({ ...current, [payload.playerId]: payload.value }))
    }
  }

  function handleRoundReveal(payload) {
    if (!payload || payload.round !== stateRef.current.round || stateRef.current.phase !== 'lock') return
    setPhase('reveal')
    setSeconds(0)
    setRevealChoices({})
    calculatedRoundRef.current = null
    broadcastMyActualChoice()
  }

  function broadcastMyActualChoice() {
    const player = stateRef.current.players.find((item) => item.id === playerId)
    if (!player || player.isDead) return
    const value = pendingGuessRef.current ?? randomGuess()
    broadcast('player_action', { type: 'reveal_choice', playerId, value })
  }

  async function handlePresenceSync(channel) {
    const presence = channel.presenceState()
    const connectedIds = new Set(Object.values(presence).flat().map((entry) => entry.id))
    if (!isHost || stateRef.current.phase === 'lobby') return

    const nextPlayers = stateRef.current.players.filter((player) => player.id === playerId || connectedIds.has(player.id))
    if (nextPlayers.length !== stateRef.current.players.length) {
      setPlayers(nextPlayers)
      broadcast('player_joined', { roster: nextPlayers, hostId: playerId, phase: stateRef.current.phase, round: stateRef.current.round, seconds: stateRef.current.seconds })
    }
  }

  function enterRoom(create) {
    const cleanName = name.trim().slice(0, 18)
    const cleanCode = create ? makeRoomCode() : joinCode.replace(/\D/g, '')
    if (!cleanName) return setError('Enter your player name')
    if (cleanCode.length !== 6) return setError('Enter a six-digit room code')

    const player = createPlayer(playerId, cleanName)
    setRoomCode(cleanCode)
    setHostId(create ? playerId : '')
    setPlayers([player])
    setPhase('lobby')
    setView('room')
  }

  function startGame() {
    if (!isHost || players.length < 2 || players.length > MAX_PLAYERS) return setError('At least 2 players are required to start')
    const nextPlayers = players.map((player) => ({ ...player, isLocked: false, currentGuess: null }))
    setPlayers(nextPlayers)
    setPhase('lock')
    setView('game')
    setSeconds(ROUND_SECONDS)
    setRevealChoices({})
    setSummary(null)
    calculatedRoundRef.current = null
    broadcast('player_action', { type: 'game_started', round, players: nextPlayers })
  }

  function lockNumber() {
    if (!me || me.isDead || phase !== 'lock' || lockedLocally) return
    const value = Math.max(0, Math.min(100, Number(guess) || 0))
    pendingGuessRef.current = value
    setLockedLocally(true)
    setPlayers((current) => current.map((player) => (
      player.id === playerId ? { ...player, isLocked: true, currentGuess: value } : player
    )))
    broadcast('player_action', { type: 'lock', playerId, isLocked: true })
  }

  function revealRound(reason) {
    if (!isHost || stateRef.current.phase !== 'lock') return
    setPhase('reveal')
    setSeconds(0)
    setRevealChoices({})
    calculatedRoundRef.current = null
    broadcast('round_reveal', { round: stateRef.current.round, reason })
    broadcastMyActualChoice()
  }

  function calculateAndApplyRound(revealed) {
    const active = stateRef.current.players.filter((player) => !player.isDead)
    const values = Object.fromEntries(active.map((player) => [player.id, revealed[player.id]]))
    const result = calculateRound(active, values)
    const nextPlayers = stateRef.current.players.map((player) => {
      const nextPoints = player.isDead ? player.points : player.points + (result.penalties[player.id] ?? 0)
      return {
        ...player,
        points: nextPoints,
        isDead: nextPoints <= -10,
        isLocked: false,
        currentGuess: values[player.id] ?? null,
      }
    })
    setPlayers(nextPlayers)
    setSummary({ ...result, choices: values, players: nextPlayers, round: stateRef.current.round })
    setPhase('summary')
    setLockedLocally(false)
    const survivors = nextPlayers.filter((player) => !player.isDead)
    if (survivors.length <= 1) setGameOver({ winner: survivors[0]?.name ?? 'NO SURVIVOR' })
  }

  function nextRound() {
    const survivors = players.filter((player) => !player.isDead)
    if (survivors.length <= 1) return setGameOver(true)
    const nextRoundNumber = round + 1
    const resetPlayers = players.map((player) => ({ ...player, isLocked: false, currentGuess: null }))
    pendingGuessRef.current = null
    setPlayers(resetPlayers)
    setRound(nextRoundNumber)
    setPhase('lock')
    setSeconds(ROUND_SECONDS)
    setSummary(null)
    setRevealChoices({})
    setLockedLocally(false)
    calculatedRoundRef.current = null
    if (isHost) broadcast('player_action', { type: 'next_round', round: nextRoundNumber })
  }

  function leaveRoom() {
    broadcast('player_action', { type: 'leave', playerId })
    channelRef.current?.unsubscribe()
    setRoomCode('')
    setPlayers([])
    setPhase('lobby')
    setView('lobby')
  }

  if (view === 'lobby') return <Lobby {...{ name, setName, joinCode, setJoinCode, enterRoom, hasSupabase, error }} />
  if (view === 'room') return <Room {...{ players, roomCode, isHost, startGame, leaveRoom, hasSupabase }} />
  return <GameBoard {...{ players, me, roomCode, round, phase, seconds, guess, setGuess, lockedLocally, lockNumber, summary, nextRound, leaveRoom, gameOver, setGameOver, hasSupabase }} />
}

function Lobby({ name, setName, joinCode, setJoinCode, enterRoom, hasSupabase, error }) {
  return <main className="lobby-shell"><div className="noise" /><header className="topline"><div className="brand-mark"><span>♦</span> KING OF DIAMONDS</div><div className="system-state"><span className="pulse-dot" /> SYSTEM ONLINE / 00:00:00</div></header><section className="lobby-hero"><div className="hero-copy"><p className="eyebrow"><Crosshair size={14} /> A MULTIPLAYER SURVIVAL PROTOCOL</p><h1>BALANCE<br /><em>OR BREAK.</em></h1><p className="hero-lede">Five minds. One target. Every number is a wager against the crowd.</p><div className="hero-rule"><span /> THE SCALE DOES NOT FORGIVE <span /></div></div><div className="terminal-panel"><div className="panel-head"><span>PLAYER IDENTIFICATION</span><span className="panel-code">AUTH // 01</span></div><label className="field-label" htmlFor="player-name">YOUR DESIGNATION</label><input id="player-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="ENTER PLAYER NAME" maxLength={18} /><button className="primary-action" onClick={() => enterRoom(true)}><Sparkles size={17} /> CREATE NEW ROOM <ChevronRight size={17} /></button><div className="or-line"><span /> OR JOIN EXISTING <span /></div><div className="join-row"><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000 000" inputMode="numeric" /><button className="join-action" onClick={() => enterRoom(false)}><DoorOpen size={17} /> JOIN</button></div><div className="connection-note">{hasSupabase ? <><Wifi size={13} /> REALTIME CHANNEL READY</> : <><WifiOff size={13} /> PREVIEW MODE · ADD SUPABASE ENV TO DEPLOY</>}</div>{error && <div className="connection-note" style={{ color: 'var(--red)' }}>{error}</div>}</div></section><footer className="lobby-footer"><span><ShieldAlert size={14} /> PLAY RESPONSIBLY. THE HOUSE ALWAYS COUNTS.</span><span>PROTOCOL 0.8 // BUILD 2026.09</span></footer></main>
}

function Room({ players, roomCode, isHost, startGame, leaveRoom, hasSupabase }) {
  const canStart = players.length >= 2 && players.length <= MAX_PLAYERS
  return <main className="room-shell"><header className="topline"><div className="brand-mark"><span>♦</span> KING OF DIAMONDS</div><button className="text-action" onClick={leaveRoom}><LogOut size={15} /> EXIT ROOM</button></header><section className="room-content"><div className="room-intro"><p className="eyebrow"><Users size={14} /> WAITING ROOM</p><h1>THE TABLE<br /><em>IS SET.</em></h1><p>Share the code. When the room is full of courage, the host may begin.</p></div><div className="room-code"><span>ROOM CODE</span><strong>{roomCode.slice(0, 3)} <b>{roomCode.slice(3)}</b></strong><button onClick={() => navigator.clipboard?.writeText(roomCode)}><Copy size={15} /> COPY CODE</button></div><div className="roster-head"><span>CONNECTED PLAYERS</span><strong>{String(players.length).padStart(2, '0')} / 05</strong></div><div className="roster">{[0, 1, 2, 3, 4].map((slot) => { const player = players[slot]; return <div className={`roster-row ${player ? 'occupied' : ''}`} key={player?.id ?? slot}><span className="slot-number">0{slot + 1}</span><span className="avatar">{player ? player.name[0].toUpperCase() : '—'}</span><span className="roster-name">{player?.name ?? 'AWAITING PLAYER'}</span>{slot === 0 && player && <span className="host-tag">HOST</span>}<span className="roster-status">{player ? 'READY' : 'OPEN'}</span></div> })}</div><div className="room-bottom"><div><Radio size={15} /> {hasSupabase ? 'BROADCAST ENCRYPTED' : 'LOCAL PREVIEW CHANNEL'}<br /><small>2–5 players · first entrant is host</small></div>{isHost ? <button className="primary-action start-button" onClick={startGame} disabled={!canStart}><Zap size={17} /> {canStart ? 'START THE GAME' : 'WAITING FOR PLAYER'} <ChevronRight size={17} /></button> : <div className="waiting-host"><Activity size={16} /> WAITING FOR HOST TO BEGIN</div>}</div></section></main>
}

function GameBoard({ players, me, roomCode, round, phase, seconds, guess, setGuess, lockedLocally, lockNumber, summary, nextRound, leaveRoom, gameOver, setGameOver, hasSupabase }) {
  return <main className="game-shell"><div className="noise" /><header className="game-header"><div className="brand-mark"><span>♦</span> KING OF DIAMONDS</div><div className="header-meta"><span>ROOM <b>{roomCode}</b></span><span>ROUND <b>{String(round).padStart(2, '0')}</b></span><span className="live-indicator"><span className="pulse-dot" /> {hasSupabase ? 'LIVE' : 'PREVIEW'}</span><button className="icon-action" title="Leave room" onClick={leaveRoom}><LogOut size={16} /></button></div></header><section className="game-main"><div className="game-title-row"><div><p className="eyebrow"><Activity size={14} /> {phase === 'lock' ? 'SELECTION PHASE' : phase === 'reveal' ? 'REVEALING NUMBERS' : 'ROUND COMPLETE'}</p><h1>FIND THE<br /><em>WEIGHT.</em></h1></div><div className={`countdown ${seconds <= 10 ? 'critical' : ''}`}><span>LOCK WINDOW</span><strong>00:{String(seconds).padStart(2, '0')}</strong><div className="timer-line"><i style={{ width: `${seconds / ROUND_SECONDS * 100}%` }} /></div></div></div><div className="players-grid">{players.map((player, index) => <PlayerCard key={player.id} player={player} index={index} me={me} />)}</div><div className="control-row"><div className="protocol-note"><LockKeyhole size={16} /><div><strong>{lockedLocally ? 'WAITING FOR OTHER PLAYERS' : 'CHOOSE IN SECRET'}</strong><span>{lockedLocally ? 'Your number is sealed. The reveal is automatic.' : 'Your number stays sealed until every player locks.'}</span></div></div><div className="choice-panel"><label htmlFor="choice">YOUR NUMBER</label><div className="choice-input"><input id="choice" type="number" min="0" max="100" value={guess} disabled={lockedLocally || me?.isDead || phase !== 'lock'} onChange={(event) => setGuess(event.target.value)} /><span>/ 100</span></div><input className="range" type="range" min="0" max="100" value={guess} disabled={lockedLocally || me?.isDead || phase !== 'lock'} onChange={(event) => setGuess(event.target.value)} /><button className={`lock-button ${lockedLocally ? 'is-locked' : ''}`} onClick={lockNumber} disabled={lockedLocally || me?.isDead || phase !== 'lock'}>{lockedLocally ? <><LockKeyhole size={17} /> NUMBER SEALED</> : <><LockKeyhole size={17} /> LOCK NUMBER</>}</button></div></div>{phase === 'reveal' && <div className="reveal-strip"><Zap size={15} /> Every client is decrypting the submitted numbers.</div>}</section>{summary && <Summary summary={summary} nextRound={nextRound} alive={players.filter((player) => !player.isDead).length} />}{gameOver && <GameOver setGameOver={setGameOver} />}</main>
}

function PlayerCard({ player, index, me }) {
  const acid = Math.min(100, Math.abs(player.points) * 10)
  return <article className={`player-card ${player.isDead ? 'dead' : ''} ${player.id === me?.id ? 'self' : ''}`}><div className="card-top"><span className="player-index">0{index + 1}</span><span className={`status ${player.isDead ? 'dead-status' : player.isLocked ? 'locked-status' : ''}`}>{player.isDead ? <><Skull size={12} /> DEAD</> : player.isLocked ? <><LockKeyhole size={12} /> LOCKED</> : <><span className="tiny-dot" /> CHOOSING</>}</span></div><div className="player-avatar">{player.isDead ? <Skull size={25} /> : player.name[0].toUpperCase()}</div><h2>{player.name}{player.id === me?.id && <small>YOU</small>}</h2><div className="points-readout"><span>POINTS</span><strong>{String(player.points).padStart(2, '0')} <i>/ -10</i></strong></div><div className="acid-bar"><span style={{ height: `${acid}%` }} /></div><div className="card-footer"><span>ACID LOAD</span><b>{acid}%</b></div></article>
}

function Summary({ summary, nextRound, alive }) {
  return <div className="overlay"><section className="summary-modal"><div className="modal-kicker"><span>ROUND {String(summary.round).padStart(2, '0')} // DECRYPTED</span><span><Activity size={14} /> RESULT</span></div><h2>THE SCALE<br /><em>HAS SPOKEN.</em></h2><div className="result-metrics"><div><span>AVERAGE</span><strong>{summary.average.toFixed(1)}</strong></div><div className="target-metric"><span>TARGET × 0.8</span><strong>{summary.target.toFixed(1)}</strong></div><div><span>WINNER</span><strong>{summary.winnerName}</strong></div></div><div className="numbers-table"><div className="table-head"><span>PLAYER</span><span>CHOICE</span><span>DELTA</span></div>{summary.players.map((player) => <div className="table-row" key={player.id}><span>{player.name}</span><span>{summary.choices[player.id]}</span><span className={summary.penalties[player.id] === 0 ? 'win-delta' : 'loss-delta'}>{summary.penalties[player.id] === 0 ? '+ WIN' : summary.penalties[player.id]}</span></div>)}</div><div className="modal-footer"><span>{alive <= 1 ? 'FINAL CALCULATION' : 'NEXT ROUND READY'}</span><button className="primary-action" onClick={nextRound}>{alive <= 1 ? 'VIEW OUTCOME' : 'CONTINUE'} <ChevronRight size={17} /></button></div></section></div>
}

function GameOver({ gameOver = { winner: 'FINAL RESULT' }, setGameOver }) {
  return <div className="game-over"><div className="game-over-grid" /><Flame size={46} /><p>PROTOCOL TERMINATED</p><h2>GAME OVER</h2><strong>ACID SCALE TILTED</strong><div className="winner-line">SURVIVOR <b>{gameOver.winner}</b></div><button className="primary-action" onClick={() => setGameOver(false)}>VIEW FINAL RESULT <ChevronRight size={17} /></button></div>
}
