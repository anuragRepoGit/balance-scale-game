export function calculateRound(players, choices) {
  const activePlayers = players.filter((player) => !player.dead)
  const values = activePlayers.map((player) => Number(choices[player.id] ?? 0))
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const target = average * 0.8
  const penalties = Object.fromEntries(activePlayers.map((player) => [player.id, -1]))
  const duplicateValues = new Set(values.filter((value, index) => values.indexOf(value) !== index))
  let winnerId = null

  if (activePlayers.length === 2 && values.includes(0) && values.includes(100)) {
    winnerId = activePlayers.find((player) => choices[player.id] === 100)?.id ?? null
  } else {
    const eligible = activePlayers.filter((player) => activePlayers.length !== 4 || !duplicateValues.has(Number(choices[player.id])))
    const ranked = eligible.map((player) => ({ player, distance: Math.abs(Number(choices[player.id]) - target) })).sort((a, b) => a.distance - b.distance)
    winnerId = ranked[0]?.player.id ?? null
    if (activePlayers.length === 3 && winnerId && Number(choices[winnerId]) === target) {
      activePlayers.forEach((player) => { penalties[player.id] = player.id === winnerId ? 0 : -2 })
    }
  }

  if (winnerId && !Object.values(penalties).some((value) => value === -2)) penalties[winnerId] = 0
  return { average, target, winnerId, winnerName: activePlayers.find((player) => player.id === winnerId)?.name ?? 'NO WINNER', penalties }
}
