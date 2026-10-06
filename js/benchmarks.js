// 벤치마크 와드 라이브러리 (Girls · Hero · Open · Games)
// text 는 공식 표기 형식 그대로 → parseWod 로 해석. 무게는 남/여 순서.
// Games 2024 이벤트 출처: theprogrm.com/blog/2024-crossfit-games, 2023 Pig Chipper: fitnessvolt.com

export const BENCHMARKS = [
  // ── Girls
  { id: 'fran', name: 'Fran', cat: 'Girls', text: `21-15-9 reps for time of:
Thrusters (95/65 lb)
Pull-ups` },
  { id: 'grace', name: 'Grace', cat: 'Girls', text: `For time:
30 clean-and-jerks (135/95 lb)` },
  { id: 'isabel', name: 'Isabel', cat: 'Girls', text: `For time:
30 snatches (135/95 lb)` },
  { id: 'helen', name: 'Helen', cat: 'Girls', text: `3 rounds for time of:
400-meter run
21 KB swings (53/35 lb)
12 pull-ups` },
  { id: 'diane', name: 'Diane', cat: 'Girls', text: `21-15-9 reps for time of:
Deadlifts (225/155 lb)
Handstand push-ups` },
  { id: 'elizabeth', name: 'Elizabeth', cat: 'Girls', text: `21-15-9 reps for time of:
Cleans (135/95 lb)
Ring dips` },
  { id: 'cindy', name: 'Cindy', cat: 'Girls', text: `AMRAP 20:
5 pull-ups
10 push-ups
15 air squats` },
  { id: 'annie', name: 'Annie', cat: 'Girls', text: `50-40-30-20-10 reps for time of:
Double-unders
Sit-ups` },
  { id: 'karen', name: 'Karen', cat: 'Girls', text: `For time:
150 wall-ball shots (20/14 lb)` },
  { id: 'jackie', name: 'Jackie', cat: 'Girls', text: `For time:
1000-meter row
50 thrusters (45/35 lb)
30 pull-ups` },
  { id: 'nancy', name: 'Nancy', cat: 'Girls', text: `5 rounds for time of:
400-meter run
15 overhead squats (95/65 lb)` },
  { id: 'kelly', name: 'Kelly', cat: 'Girls', text: `5 rounds for time of:
400-meter run
30 box jumps (24/20 in)
30 wall-ball shots (20/14 lb)` },
  { id: 'mary', name: 'Mary', cat: 'Girls', text: `AMRAP 20:
5 handstand push-ups
10 pistols
15 pull-ups` },
  { id: 'angie', name: 'Angie', cat: 'Girls', text: `For time:
100 pull-ups
100 push-ups
100 sit-ups
100 air squats` },
  { id: 'barbara', name: 'Barbara', cat: 'Girls', text: `5 rounds for time of:
20 pull-ups
30 push-ups
40 sit-ups
50 air squats
Rest 3 minutes between rounds` },
  { id: 'chelsea', name: 'Chelsea', cat: 'Girls', text: `EMOM 30:
5 pull-ups
10 push-ups
15 air squats` },
  { id: 'amanda', name: 'Amanda', cat: 'Girls', text: `9-7-5 reps for time of:
Ring muscle-ups
Squat snatches (135/95 lb)` },
  { id: 'eva', name: 'Eva', cat: 'Girls', text: `5 rounds for time of:
800-meter run
30 KB swings (70/53 lb)
30 pull-ups` },

  // ── Hero
  { id: 'murph', name: 'Murph', cat: 'Hero', text: `For time:
1-mile run
100 pull-ups
200 push-ups
300 air squats
1-mile run
*Wear a 20/14-lb vest` },
  { id: 'dt', name: 'DT', cat: 'Hero', text: `5 rounds for time of:
12 deadlifts
9 hang power cleans
6 push jerks
Men: 155 lb / Women: 105 lb` },
  { id: 'jt', name: 'JT', cat: 'Hero', text: `21-15-9 reps for time of:
Handstand push-ups
Ring dips
Push-ups` },

  // ── Open
  { id: 'open-24.1', name: 'Open 24.1', cat: 'Open', year: 2024, text: `For time:
21 DB snatches (arm 1)
21 lateral burpees over DB
21 DB snatches (arm 2)
21 lateral burpees over DB
15 DB snatches (arm 1)
15 lateral burpees over DB
15 DB snatches (arm 2)
15 lateral burpees over DB
9 DB snatches (arm 1)
9 lateral burpees over DB
9 DB snatches (arm 2)
9 lateral burpees over DB
Men: 50-lb DB
Women: 35-lb DB
Time cap: 15 minutes` },
  { id: 'open-24.2', name: 'Open 24.2', cat: 'Open', year: 2024, text: `AMRAP 20:
300-meter row
10 deadlifts
50 double-unders
Men: 185 lb
Women: 125 lb` },
  { id: 'open-24.3', name: 'Open 24.3', cat: 'Open', year: 2024, text: `5 rounds for time of:
10 thrusters (95/65 lb)
10 chest-to-bar pull-ups
Rest 1 minute, then:
5 rounds for time of:
7 thrusters (135/95 lb)
7 bar muscle-ups
Time cap: 15 minutes` },
  { id: 'open-23.1', name: 'Open 23.1 (14.4)', cat: 'Open', year: 2023, text: `AMRAP 14:
60-cal row
50 toes-to-bars
40 wall-ball shots (20/14 lb)
30 cleans (135/95 lb)
20 ring muscle-ups` },
  { id: 'open-22.1', name: 'Open 22.1', cat: 'Open', year: 2022, text: `AMRAP 15:
3 wall walks
12 DB snatches (50/35 lb)
15 box jump-overs (24/20 in)` },
  { id: 'open-22.3', name: 'Open 22.3', cat: 'Open', year: 2022, text: `For time:
21 pull-ups
42 double-unders
21 thrusters (95/65 lb)
18 chest-to-bar pull-ups
36 double-unders
18 thrusters (115/75 lb)
15 bar muscle-ups
30 double-unders
15 thrusters (135/85 lb)
Time cap: 12 minutes` },
  { id: 'open-21.1', name: 'Open 21.1', cat: 'Open', year: 2021, text: `For time:
1 wall walk
10 double-unders
3 wall walks
30 double-unders
6 wall walks
60 double-unders
9 wall walks
90 double-unders
15 wall walks
150 double-unders
21 wall walks
210 double-unders
Time cap: 15 minutes` },
  { id: 'open-20.1', name: 'Open 20.1', cat: 'Open', year: 2020, text: `10 rounds for time of:
8 ground-to-overheads (95/65 lb)
10 bar-facing burpees
Time cap: 15 minutes` },
  { id: 'open-19.1', name: 'Open 19.1', cat: 'Open', year: 2019, text: `AMRAP 15:
19 wall-ball shots (20/14 lb)
19-cal row` },
  { id: 'open-18.1', name: 'Open 18.1', cat: 'Open', year: 2018, text: `AMRAP 20:
8 toes-to-bars
10 DB hang clean-and-jerks (50/35 lb)
14/12-cal row` },
  { id: 'open-17.1', name: 'Open 17.1', cat: 'Open', year: 2017, text: `For time:
10 DB snatches
15 burpee box jump-overs
20 DB snatches
15 burpee box jump-overs
30 DB snatches
15 burpee box jump-overs
40 DB snatches
15 burpee box jump-overs
50 DB snatches
15 burpee box jump-overs
Men: 50-lb DB, 24-in box
Women: 35-lb DB, 20-in box
Time cap: 20 minutes` },
  { id: 'open-16.5', name: 'Open 16.5 (14.5)', cat: 'Open', year: 2016, text: `21-18-15-12-9-6-3 reps for time of:
Thrusters (95/65 lb)
Bar-facing burpees` },

  // ── Games
  { id: 'games-2024-midline', name: 'Midline Climb', cat: 'Games', year: 2024, text: `For time:
50 deadlifts (225/155 lb)
5 rope climbs
50/30-cal ski erg
5 rope climbs
50 GHD sit-ups
5 rope climbs
50 GHD sit-ups
5 rope climbs
50/30-cal ski erg
5 rope climbs
50 deadlifts (225/155 lb)` },
  { id: 'games-2024-firestorm', name: 'Firestorm', cat: 'Games', year: 2024, text: `3 rounds for time of:
15/11-cal Echo bike
11 burpees over barricade` },
  { id: 'games-2024-track', name: 'Track & Field', cat: 'Games', year: 2024, text: `For time:
1600-meter run
Then,
50-yard sprint
50-yard bag carry (100/70 lb)
75-yard sprint
75-yard bag carry (100/70 lb)
100-yard sprint` },
  { id: 'games-2024-pushpull', name: 'Push Pull 2.0', cat: 'Games', year: 2024, text: `For time:
45 handstand push-ups
80-foot sled pull from standing (180/110 lb)
30 strict handstand push-ups
80-foot seated sled pull (180/110 lb)
15 freestanding handstand push-ups
Time cap: 10 minutes` },
  { id: 'games-2024-dickie', name: "Dickie's Triplet", cat: 'Games', year: 2024, text: `5 rounds for time of:
175-meter run
12 toes-to-bars
8 alternating DB snatches (100/70 lb)
Time cap: 11 minutes` },
  { id: 'games-2024-final', name: 'Final 2421', cat: 'Games', year: 2024, text: `For time:
24 thrusters (95/65 lb)
24 chest-to-bar pull-ups
80-foot yoke carry (425/245 lb)
21 chest-to-bar pull-ups
21 thrusters (95/65 lb)
Time cap: 5 minutes` },
  { id: 'games-2023-pig', name: 'Pig Chipper', cat: 'Games', year: 2023, text: `For time:
10 pig flips
25 chest-to-bar pull-ups
50 toes-to-bars
100 wall-ball shots (20/14 lb)
50 toes-to-bars
25 chest-to-bar pull-ups
10 pig flips` },
];

export const BENCH_BY_ID = Object.fromEntries(BENCHMARKS.map(b => [b.id, b]));
export const BENCH_CATS = ['Girls', 'Hero', 'Open', 'Games'];

// 붙여넣은 원문에서 벤치마크 이름 찾기 (줄 전체가 이름이거나 "Open 24.1" / "24.1" 형태)
export function detectBenchmark(raw) {
  const lines = raw.split(/\r?\n/).map(l => l.trim().toLowerCase()).filter(Boolean);
  for (const b of BENCHMARKS) {
    const names = [b.name.toLowerCase(), b.name.toLowerCase().replace(/\s*\(.*\)$/, '')];
    if (b.cat === 'Open') names.push(b.id.replace('open-', ''));
    if (lines.some(l => names.includes(l.replace(/[“”"':]/g, '').trim()))) return b.id;
  }
  return null;
}
