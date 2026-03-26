const ADJECTIVES = [
  "Amber",
  "Bright",
  "Calm",
  "Cedar",
  "Clear",
  "Coral",
  "Golden",
  "Harbor",
  "Maple",
  "North",
  "Quiet",
  "River",
  "Silver",
  "Solar",
  "Spring",
  "Summit",
  "Willow",
  "Winter",
] as const;

const NOUNS = [
  "Badgers",
  "Canyon",
  "Cedars",
  "Falcons",
  "Foxes",
  "Harbor",
  "Hawks",
  "Lakers",
  "Otters",
  "Owls",
  "Pines",
  "Ravens",
  "Ridge",
  "Spruce",
  "Tigers",
  "Trail",
  "Wolves",
  "Yard",
] as const;

function pickRandom<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function generateRosterName() {
  return `${pickRandom(ADJECTIVES)} ${pickRandom(NOUNS)}`;
}
