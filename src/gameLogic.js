export function calculateRound(players, choices) {
  const activePlayers = players.filter((player) => !player.isDead && !player.dead)
  const normalizedChoices = Object.fromEntries(activePlayers.map((player) => [player.id, Number(choices[player.id] ?? 0)]))
  const values = activePlayers.map((player) => normalizedChoices[player.id])
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const target = average * 0.8
  const penalties = Object.fromEntries(activePlayers.map((player) => [player.id, -1]))
  const duplicateValues = new Set(values.filter((value, index) => values.indexOf(value) !== index))
  const duplicateIds = new Set(activePlayers
    .filter((player) => duplicateValues.has(normalizedChoices[player.id]))
    .map((player) => player.id))
  let winnerId = null

  if (activePlayers.length === 2 && values.includes(0) && values.includes(100)) {
    winnerId = activePlayers.find((player) => normalizedChoices[player.id] === 100)?.id ?? null
  } else {
    const eligible = activePlayers.filter((player) => !duplicateIds.has(player.id))
    const exactTargetPlayer = activePlayers.length === 3
      ? eligible.find((player) => normalizedChoices[player.id] === target)
      : null
    const ranked = eligible.map((player) => ({ player, distance: Math.abs(normalizedChoices[player.id] - target) })).sort((a, b) => a.distance - b.distance)
    winnerId = exactTargetPlayer?.id ?? ranked[0]?.player.id ?? null
    if (activePlayers.length === 3 && exactTargetPlayer) {
      activePlayers.forEach((player) => {
        penalties[player.id] = player.id === winnerId ? 0 : duplicateIds.has(player.id) ? -1 : -2
      })
    }
  }

  if (winnerId && !duplicateIds.has(winnerId)) penalties[winnerId] = 0
  return { average, target, winnerId, winnerName: activePlayers.find((player) => player.id === winnerId)?.name ?? 'NO WINNER', penalties }
}
