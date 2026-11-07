/**
 * Standard competition ranking: students on equal points share a rank and the
 * next rank skips (1, 2, 2, 4). Ties are ordered by name so the board does not
 * reshuffle between two identical requests.
 *
 * Kept as a pure function so the rule can be tested without a database.
 */
const assignRanks = (rows) => {
  const sorted = [...rows].sort(
    (a, b) => (b.points - a.points) || String(a.name).localeCompare(String(b.name))
  );

  let previousPoints = null;
  let previousRank = 0;

  return sorted.map((row, index) => {
    const rank = row.points === previousPoints ? previousRank : index + 1;
    previousPoints = row.points;
    previousRank = rank;
    return { rank, name: row.name, points: row.points, returns: row.returns };
  });
};

module.exports = { assignRanks };
