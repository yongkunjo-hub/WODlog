// 운동 사전
// 일량 모델 (1회당 J):
//   kind 'load' : (기구무게 × 개수 × rom + 체중 × bw × bwRom) × g × 키
//                 rom/bwRom 은 키 대비 비율, romM/bwRomM 이 있으면 절대 미터로 사용
//   kind 'erg'  : cal → J_PER_CAL, m → jPerM
//   kind 'run'  : 체중 × J_PER_KG_M × 거리(m)
//   kind 'carry': (체중 + 기구무게) × CARRY_J_PER_KG_M × 거리(m)  — 요크·샌드백·파머스 캐리
//   kind 'drag' : 썰매 무게 × 마찰계수 SLED_MU × g × 거리(m)
//   kind 'none' : 일량 계산 제외 (기록만)
// equip: 'db' 덤벨, 'kb' 케틀벨, 'bb' 바벨, 'ball' 메디신볼, 'other' 썰매·요크·샌드백 등, 없으면 맨몸

export const G = 9.81;
// Concept2 칼로리 공식(cal/hr = 4 × 0.8604 × W + 300)에서 기초대사 300을 뺀 기계적 일량
export const J_PER_CAL = 1046;
// 러닝: 1 kcal/kg/km × 4184 J × 효율 25%
export const J_PER_KG_M = 1.046;
// 짐을 들고 걷기: 러닝의 절반 수준으로 근사
export const CARRY_J_PER_KG_M = 0.5;
// 썰매와 바닥(인조잔디) 사이 마찰계수 근사
export const SLED_MU = 0.35;

export const MOVEMENTS = [
  // ── 유산소 머신
  { key: 'bike_erg', name: 'Bike Erg', kind: 'erg', unit: 'cal', jPerM: 24, aliases: ['bike erg', 'bikeerg', 'c2 bike', 'bike', '바이크', '바이크에르그'] },
  { key: 'row', name: 'Row', kind: 'erg', unit: 'cal', jPerM: 48.6, aliases: ['row', 'rower', 'rowing', 'row erg', '로잉', '로우'] },
  { key: 'ski_erg', name: 'Ski Erg', kind: 'erg', unit: 'cal', jPerM: 48.6, aliases: ['ski erg', 'skierg', 'ski', '스키', '스키에르그'] },
  { key: 'echo_bike', name: 'Echo Bike', kind: 'erg', unit: 'cal', jPerM: 24, aliases: ['echo bike', 'assault bike', 'air bike', 'airdyne', '어썰트바이크', '에코바이크', 'a bike', 'assault'] },
  { key: 'run', name: 'Run', kind: 'run', unit: 'm', aliases: ['run', 'running', 'runs', 'sprint', 'shuttle run', 'shuttle sprint', '러닝', '달리기', '런', '스프린트'] },
  { key: 'swim', name: 'Swim', kind: 'none', unit: 'm', aliases: ['swim', 'swimming', '수영'] },

  // ── 덤벨
  { key: 'db_front_lunge', name: 'DB Front Lunge', kind: 'load', equip: 'db', implements: 2, rom: 0.22, bw: 0.85, bwRom: 0.22, aliases: ['db front lunge', 'db front rack lunge', 'dumbbell front lunge', 'db front rack lunges', 'db lunge', 'lg', '덤벨 런지', '덤벨런지'] },
  { key: 'db_clean', name: 'DB Clean', kind: 'load', equip: 'db', implements: 2, rom: 0.70, bw: 0.85, bwRom: 0.12, aliases: ['db clean', 'db squat clean', 'db power clean', 'dumbbell clean', '덤벨 클린', '덤벨클린'] },
  { key: 'db_hang_clean', name: 'DB Hang Clean', kind: 'load', equip: 'db', implements: 2, rom: 0.52, bw: 0.85, bwRom: 0.12, aliases: ['db hang clean', 'db hang power clean', 'db hang squat clean', 'dumbbell hang clean', '덤벨 행클린'] },
  { key: 'db_snatch', name: 'DB Snatch', kind: 'load', equip: 'db', implements: 1, rom: 1.15, bw: 0.85, bwRom: 0.12, aliases: ['db snatch', 'dumbbell snatch', 'db power snatch', 'db hang snatch', 'db hang power snatch', 'db hsn', 'dbhsn', 'dbsn', '덤벨 스내치'] },
  { key: 'db_thruster', name: 'DB Thruster', kind: 'load', equip: 'db', implements: 2, rom: 0.75, bw: 0.85, bwRom: 0.25, aliases: ['db thruster', 'dumbbell thruster', '덤벨 쓰러스터'] },
  { key: 'db_box_step_over', name: 'DB Box Step Over', kind: 'load', equip: 'db', implements: 2, romM: 0.5, bw: 1, bwRomM: 0.5, aliases: ['db box step over', 'db box step-over', 'db step over', 'db step up'] },
  { key: 'db_shoulder_to_overhead', name: 'DB Shoulder to Overhead', kind: 'load', equip: 'db', implements: 2, rom: 0.35, bw: 0, aliases: ['db shoulder to overhead', 'db push press', 'db push jerk', 'db stoh', 'db s2oh', 'db strict press', 'db pp', 'dbpp', 'db hang clean and press', 'db press'] },
  { key: 'db_deadlift', name: 'DB Deadlift', kind: 'load', equip: 'db', implements: 2, rom: 0.32, bw: 0.6, bwRom: 0.12, aliases: ['db deadlift', 'dumbbell deadlift', '덤벨 데드리프트', 'dbdl', 'db rdl', 'db romanian deadlift', 'db cross body rdl'] },
  { key: 'devil_press', name: 'Devil Press', kind: 'load', equip: 'db', implements: 2, rom: 1.15, bw: 1, bwRom: 0.45, aliases: ['devil press', 'db devil press', 'devils press'] },
  { key: 'db_hang_clean_and_jerk', name: 'DB Hang Clean & Jerk', kind: 'load', equip: 'db', implements: 1, rom: 0.95, bw: 0.85, bwRom: 0.15, aliases: ['db hang clean and jerk', 'db hang clean & jerk', 'db hang clean and jerks', 'dumbbell hang clean and jerk'] },
  { key: 'db_walking_lunge', name: 'DB Walking Lunge', kind: 'load', equip: 'db', implements: 2, rom: 0.22, bw: 0.85, bwRom: 0.22, aliases: ['db walking lunge', 'db lunges', 'dumbbell walking lunge', 'db front rack walking lunge', 'db farmers back lunge', 'db farmers lunge', 'farmers back lunge', 'farmers lunge', 'db reverse lunge', 'db back lunge', 'kb goblet front lunge', 'kb goblet lunge', 'kb front rack lunge', 'kb front rack walking lunge', 'goblet lunge', 'kb goblet reverse lunge', 'db split squat', 'db bulgarian split squat'] },
  { key: 'renegade_row', name: 'Renegade Row', kind: 'load', equip: 'db', implements: 2, romM: 0.35, bw: 0.64, bwRom: 0.05, aliases: ['renegade row', 'db renegade row'] },
  { key: 'kb_snatch', name: 'KB Snatch', kind: 'load', equip: 'kb', implements: 1, rom: 1.1, bw: 0.85, bwRom: 0.12, aliases: ['kb snatch', 'kb hang snatch', 'kettlebell snatch', 'kbhsn', 'kbsn', 'kb hsn'] },
  { key: 'step_up', name: 'Weighted Step-up', kind: 'load', equip: 'other', implements: 1, romM: 0.5, bw: 1, bwRomM: 0.5, aliases: ['weighted step up', 'step up', 'step ups', 'box step up', 'weighted box step up'] },
  { key: 'goblet_squat', name: 'Goblet Squat', kind: 'load', equip: 'db', implements: 1, rom: 0.25, bw: 0.85, bwRom: 0.25, aliases: ['goblet squat', 'db goblet squat', 'kb goblet squat', '고블릿 스쿼트', 'db squat', 'db front squat', 'dbsq'] },

  // ── 케틀벨 / 볼
  { key: 'kb_swing', name: 'KB Swing', kind: 'load', equip: 'kb', implements: 1, rom: 0.9, bw: 0.6, bwRom: 0.08, aliases: ['kb swing', 'kettlebell swing', 'american kb swing', 'russian kb swing', '케틀벨 스윙', 'kb american swing', 'kb russian swing', 'american kettlebell swing', 'russian kettlebell swing', 'american swing', 'russian swing', 'kbs'] },
  { key: 'wall_ball', name: 'Wall Ball', kind: 'load', equip: 'ball', implements: 1, romM: 2.5, bw: 0.85, bwRom: 0.25, aliases: ['wall ball', 'wall ball shot', 'wallball', 'wb', 'wbs', '월볼'] },
  { key: 'ball_thruster', name: 'Med Ball Thruster', kind: 'load', equip: 'ball', implements: 1, rom: 0.75, bw: 0.85, bwRom: 0.25, aliases: ['medball thruster', 'med ball thruster', 'ball thruster'] },
  { key: 'plate_g2oh', name: 'Plate Ground to Overhead', kind: 'load', equip: 'other', implements: 1, rom: 1.15, bw: 0.85, bwRom: 0.15, aliases: ['plate ground to overhead', 'plate g2oh', 'plate gtoh', 'plate hang to overhead', 'plate overhead'] },

  // ── 바벨
  { key: 'deadlift', name: 'Deadlift', kind: 'load', equip: 'bb', implements: 1, rom: 0.32, bw: 0.6, bwRom: 0.12, aliases: ['deadlift', 'dl', '데드리프트', '데드', 'rdl', 'romanian deadlift', 'stiff leg deadlift', 'sldl'] },
  { key: 'back_squat', name: 'Back Squat', kind: 'load', equip: 'bb', implements: 1, rom: 0.25, bw: 0.85, bwRom: 0.25, aliases: ['back squat', 'bs', '백스쿼트'] },
  { key: 'front_squat', name: 'Front Squat', kind: 'load', equip: 'bb', implements: 1, rom: 0.25, bw: 0.85, bwRom: 0.25, aliases: ['front squat', 'fs', '프론트스쿼트'] },
  { key: 'overhead_squat', name: 'Overhead Squat', kind: 'load', equip: 'bb', implements: 1, rom: 0.25, bw: 0.85, bwRom: 0.25, aliases: ['overhead squat', 'ohs', '오버헤드스쿼트'] },
  { key: 'thruster', name: 'Thruster', kind: 'load', equip: 'bb', implements: 1, rom: 0.75, bw: 0.85, bwRom: 0.25, aliases: ['thruster', 'cluster', 'squat clean thruster', '쓰러스터', 'th'] },
  { key: 'clean', name: 'Clean', kind: 'load', equip: 'bb', implements: 1, rom: 0.70, bw: 0.85, bwRom: 0.12, aliases: ['clean', 'squat clean', 'power clean', '클린', '파워클린', '스쿼트클린', 'pc', 'scl', 'sqcl'] },
  { key: 'hang_clean', name: 'Hang Clean', kind: 'load', equip: 'bb', implements: 1, rom: 0.45, bw: 0.85, bwRom: 0.12, aliases: ['hang clean', 'hang power clean', 'hang squat clean', '행클린', 'hpc', 'hsc', 'hscl', 'low hang clean'] },
  { key: 'clean_and_jerk', name: 'Clean & Jerk', kind: 'load', equip: 'bb', implements: 1, rom: 1.05, bw: 0.85, bwRom: 0.2, aliases: ['clean and jerk', 'clean & jerk', 'c&j', '클린앤저크', 'cj', 'power clean and jerk', 'hang clean and jerk', 'hang power clean and jerk'] },
  { key: 'snatch', name: 'Snatch', kind: 'load', equip: 'bb', implements: 1, rom: 1.15, bw: 0.85, bwRom: 0.12, aliases: ['snatch', 'power snatch', 'squat snatch', '스내치', 'sn', 'psn', 'ssn', 'sqsn'] },
  { key: 'hang_snatch', name: 'Hang Snatch', kind: 'load', equip: 'bb', implements: 1, rom: 0.9, bw: 0.85, bwRom: 0.12, aliases: ['hang snatch', 'hang power snatch', 'hang squat snatch', '행스내치', 'hsn', 'hpsn', 'hps', 'high hang pull', 'hang half snatch', 'low hang power snatch'] },
  { key: 'shoulder_to_overhead', name: 'Shoulder to Overhead', kind: 'load', equip: 'bb', implements: 1, rom: 0.35, bw: 0, aliases: ['shoulder to overhead', 's2oh', 'stoh', 'push press', 'push jerk', 'split jerk', 'jerk', 'strict press', 'press', '푸시프레스', '저크', 'pp', 'behind neck jerk', 'tall jerk', 'sots press'] },
  { key: 'bench_press', name: 'Bench Press', kind: 'load', equip: 'bb', implements: 1, rom: 0.25, bw: 0, aliases: ['bench press', 'bench', '벤치프레스'] },
  { key: 'ground_to_overhead', name: 'Ground to Overhead', kind: 'load', equip: 'bb', implements: 1, rom: 1.15, bw: 0.85, bwRom: 0.15, aliases: ['ground to overhead', 'ground to overheads', 'gtoh', 'g2oh'] },
  { key: 'overhead_lunge', name: 'Overhead Lunge', kind: 'load', equip: 'bb', implements: 1, rom: 0.22, bw: 0.85, bwRom: 0.22, aliases: ['overhead lunge', 'overhead walking lunge', 'oh lunge', 'front rack lunge', 'barbell lunge', 'overhead front lunge', 'front rack reverse lunge', 'bb front rack reverse lunge', 'bb front rack lunge', 'bb reverse lunge', 'back rack lunge'] },
  { key: 'yoke_carry', name: 'Yoke Carry', kind: 'carry', equip: 'other', unit: 'm', aliases: ['yoke carry', 'yoke', '요크'] },
  { key: 'bag_carry', name: 'Sandbag Carry', kind: 'carry', equip: 'other', unit: 'm', aliases: ['bag carry', 'sandbag carry', 'sandbag', '샌드백 캐리'] },
  { key: 'farmer_carry', name: 'Farmer Carry', kind: 'carry', equip: 'db', implements: 2, unit: 'm', aliases: ['farmer carry', 'farmers carry', 'db farmer carry', '파머스 캐리', 'farmers grip carry', 'farmer grip carry', 'kb farmers carry'] },
  { key: 'sled_pull', name: 'Sled Pull', kind: 'drag', equip: 'other', unit: 'm', aliases: ['sled pull', 'seated sled pull', 'sled pull from standing', 'sled drag', '썰매 끌기'] },
  { key: 'sled_push', name: 'Sled Push', kind: 'drag', equip: 'other', unit: 'm', aliases: ['sled push', 'prowler push', '썰매 밀기'] },
  { key: 'pig_flip', name: 'Pig Flip', kind: 'none', aliases: ['pig flip', 'pig flips', 'tire flip'] },
  { key: 'sdhp', name: 'Sumo Deadlift High Pull', kind: 'load', equip: 'bb', implements: 1, rom: 0.55, bw: 0.6, bwRom: 0.12, aliases: ['sumo deadlift high pull', 'sdhp'] },

  // ── 체조 / 맨몸
  { key: 'toes_to_bar', name: 'Toes to Bar', kind: 'load', bw: 0.35, bwRom: 0.5, aliases: ['toes to bar', 'toes-to-bar', 't2b', 'ttb', '토투바', 'toes to ring', 'toes-to-ring', 't2r'] },
  { key: 'knees_to_elbow', name: 'Knees to Elbow', kind: 'load', bw: 0.35, bwRom: 0.4, aliases: ['knees to elbow', 'knees to elbows', 'k2e', '니투엘보', 'hanging leg raise', 'leg raise'] },
  { key: 'knee_to_chest', name: 'Knee to Chest', kind: 'load', bw: 0.35, bwRom: 0.25, aliases: ['knee to chest', 'knees to chest', 'k2c', 'hanging knee raise', '니투체스트', 'knee up', 'knee ups', 'hanging knee up'] },
  { key: 'pull_up', name: 'Pull-up', kind: 'load', bw: 0.95, bwRom: 0.35, aliases: ['pull-up', 'pull up', 'pullup', 'kipping pull-up', 'butterfly pull-up', 'strict pull-up', '풀업', 'pu', 'chin up', 'chin-up', 'chinup', 'banded pull up', 'banded pu', 'bar pull up', 'jumping pull up'] },
  { key: 'chest_to_bar', name: 'Chest to Bar', kind: 'load', bw: 0.95, bwRom: 0.4, aliases: ['chest to bar', 'chest-to-bar', 'c2b', 'ctb', 'chest to bar pull-up', '체스트투바', 'ctb pu', 'bpctb'] },
  { key: 'bar_muscle_up', name: 'Bar Muscle-up', kind: 'load', bw: 0.95, bwRom: 0.6, aliases: ['bar muscle-up', 'bar muscle up', 'bmu', '바머슬업', 'bpbmu'] },
  { key: 'ring_muscle_up', name: 'Ring Muscle-up', kind: 'load', bw: 0.95, bwRom: 0.6, aliases: ['ring muscle-up', 'ring muscle up', 'muscle-up', 'muscle up', 'rmu', '링머슬업', '머슬업', 'mu'] },
  { key: 'push_up', name: 'Push-up', kind: 'load', bw: 0.64, bwRom: 0.18, aliases: ['push-up', 'push up', 'pushup', 'hand release push-up', 'hrpu', '푸시업', '푸쉬업'] },
  { key: 'hspu', name: 'Handstand Push-up', kind: 'load', bw: 0.9, bwRom: 0.25, aliases: ['handstand push-up', 'handstand push up', 'hspu', 'strict hspu', 'kipping hspu', 'freestanding handstand push up', 'deficit handstand push up', 'wall facing handstand push up', '물구나무푸시업'] },
  { key: 'burpee', name: 'Burpee', kind: 'load', bw: 1, bwRom: 0.45, aliases: ['burpee', 'burpees', 'no jump burpee', 'burpee to plate', 'burpee to target', '버피'] },
  { key: 'bar_facing_burpee', name: 'Bar Facing Burpee', kind: 'load', bw: 1, bwRom: 0.5, aliases: ['bar facing burpee', 'bar-facing burpee', 'bfb', 'burpee over the bar', 'burpee over bar', 'bobb', 'lateral burpee over bar', 'lateral burpee over db', 'lateral burpee over the db', 'burpee over db', 'burpee over barricade', 'burpee over the barricade', 'bar touch burpee', 'bar lateral burpee', 'lateral bar burpee', 'burpee over plate', 'burpee plate over'] },
  { key: 'burpee_pull_up', name: 'Burpee Pull-up', kind: 'load', bw: 1, bwRom: 0.8, aliases: ['burpee pull-up', 'burpee pull up', 'burpee pullup', '버피 풀업', 'burpee strict pull up', 'bppu'] },
  { key: 'box_jump', name: 'Box Jump', kind: 'load', bw: 1, bwRomM: 0.6, boxHeight: true, aliases: ['box jump', 'box jump over', 'bjo', 'box jumps', '박스점프'] },
  { key: 'air_squat', name: 'Air Squat', kind: 'load', bw: 0.85, bwRom: 0.25, aliases: ['air squat', 'squat', '에어스쿼트'] },
  { key: 'sit_up', name: 'Sit-up', kind: 'load', bw: 0.6, bwRom: 0.2, aliases: ['sit-up', 'sit up', 'situp', 'abmat sit-up', 'ab mat sit-up', 'ab mat sit up', '싯업', 'mat sit up', 'ab mat situp', 'abmat situp'] },
  { key: 'wall_walk', name: 'Wall Walk', kind: 'load', bw: 1, bwRomM: 0.9, aliases: ['wall walk', 'wall walks', '월워크', 'wallwalk', 'walk out', 'ww', 'inch worm', 'inchworm', 'in worm'] },
  { key: 'kip_swing', name: 'Kip Swing', kind: 'load', bw: 0.35, bwRom: 0.2, aliases: ['kip swing', 'kipping swing', '킵스윙', 'hollow body swing', 'hollow rock', 'hollow body rock'] },
  { key: 'double_under', name: 'Double Under', kind: 'load', bw: 1, bwRomM: 0.12, aliases: ['double under', 'double-under', 'du', 'dus', '더블언더'] },
  { key: 'single_under', name: 'Single Under', kind: 'load', bw: 1, bwRomM: 0.05, aliases: ['single under', 'single-under', 'su', '싱글언더', '줄넘기', 'crossover single under', 'cross over single under', 'cosu', 'co su'] },
  { key: 'rope_climb', name: 'Rope Climb', kind: 'load', bw: 1, bwRomM: 4.5, aliases: ['rope climb', 'rope climbs', 'legless rope climb', 'rc', '로프클라임'] },
  { key: 'pegboard', name: 'Peg Board', kind: 'load', bw: 1, bwRomM: 3.0, aliases: ['peg board', 'pegboard', 'peg board ascent', 'pegboard ascent'] },
  { key: 'ghd_sit_up', name: 'GHD Sit-up', kind: 'load', bw: 0.6, bwRom: 0.35, aliases: ['ghd sit up', 'ghd situp', 'ghd', 'ghd sit-ups'] },
  { key: 'ring_dip', name: 'Ring Dip', kind: 'load', bw: 0.95, bwRom: 0.25, aliases: ['ring dip', 'ring dips', 'dip', 'bar dip', '링딥'] },
  { key: 'burpee_box_jump_over', name: 'Burpee Box Jump-over', kind: 'load', bw: 1, bwRomM: 1.0, boxHeight: true, aliases: ['burpee box jump over', 'burpee box jump-over', 'bbjo', 'burpee box jump', 'burpee box get over', 'burpee box step up', 'burpee box step over', 'bbgo', 'bpbjo'] },
  { key: 'pistol', name: 'Pistol', kind: 'load', bw: 0.85, bwRom: 0.3, aliases: ['pistol', 'pistol squat', 'single leg squat', '피스톨'] },
  { key: 'v_up', name: 'V-up', kind: 'load', bw: 0.6, bwRom: 0.35, aliases: ['v up', 'v-up', 'vup', 'alter v up', 'alternating v up', 'single leg v up', 'med ball v up', 'tuck up', 'tuck-up', '브이업', 'jack knife', 'jackknife'] },
  { key: 'crunch', name: 'Crunch', kind: 'load', bw: 0.4, bwRom: 0.12, aliases: ['crunch', 'heel touch', 'alter heel touch', 'alternating heel touch', '크런치', 'russian twist', 'kb russian twist', 'plate russian twist'] },
  { key: 'lunge', name: 'Lunge', kind: 'load', bw: 0.85, bwRom: 0.22, aliases: ['lunge', 'walking lunge', 'reverse lunge', 'back lunge', 'front lunge', 'alternating lunge', 'jumping lunge', '런지', 'split squat', 'bulgarian split squat'] },
  { key: 'box_step_over', name: 'Box Step-over', kind: 'load', bw: 1, bwRomM: 0.55, boxHeight: true, aliases: ['box step over', 'box step-over', 'step over'] },
  { key: 'broad_jump', name: 'Broad Jump', kind: 'load', bw: 1, bwRomM: 0.5, aliases: ['broad jump', 'broad jumps', '멀리뛰기', 'kneeling jump', 'db hop jump', 'hop jump', 'tuck jump', 'jumping jack'] },
  { key: 'plank', name: 'Plank', kind: 'none', aliases: ['plank', 'side plank', 'chinese plank', 'weighted chinese plank', 'hollow hold', 'hip bridge', '플랭크'] },
  { key: 'good_morning', name: 'Good Morning', kind: 'load', equip: 'bb', implements: 1, rom: 0.3, bw: 0.6, bwRom: 0.15, aliases: ['good morning', 'good mornings'] },
  { key: 'pendlay_row', name: 'Barbell Row', kind: 'load', equip: 'bb', implements: 1, romM: 0.4, bw: 0, aliases: ['pendlay row', 'barbell row', 'bent over row', 'bb row'] },
  { key: 'accessory', name: 'Accessory', kind: 'none', aliases: ['lu raise', 'banded arm pull down', 'banded pull down', 'lat pull down', 'face pull', 'lateral raise', 'db curl', 'bicep curl', 'db standing tricep extension', 'tricep extension', 'bent over reverse fly', 'reverse fly', 'banded hip thrust', 'hip thrust', 'db hip thrust', 'deadbug', 'dead bug', 'banded deadbug', 'banded push down', 'push down', 'plate weighted hip extension', 'hip extension', 'kb power stairs', 'power stairs', 'superman'] },
  { key: 'mountain_climber', name: 'Mountain Climber', kind: 'load', bw: 0.5, bwRom: 0.1, aliases: ['mountain climber', 'mountain climbers', '마운틴클라이머'] },
  { key: 'handstand_walk', name: 'Handstand Walk', kind: 'none', unit: 'm', aliases: ['handstand walk', 'hsw', '핸드스탠드워크'] },
];

export const BY_KEY = Object.fromEntries(MOVEMENTS.map(m => [m.key, m]));

// 사전 페이스(초/단위): 중급자가 메트콘 안에서 기준 무게로 수행할 때의 대략값
// (세트 사이 휴식·피로 포함, 운동 간 전환 시간은 TRANSITION_SEC 로 따로 계산)
// 내 기록이 쌓이면 recommend.js 가 이 값을 출발점으로 개인 페이스를 추정한다
export const REF_LOAD = { db: 15, kb: 16, bb: 40, ball: 9, other: 40 };
export const TRANSITION_SEC = 8;
export const PRIOR_PACE = {
  bike_erg: { cal: 4.5, m: 0.12 }, row: { cal: 5.0, m: 0.25 }, ski_erg: { cal: 5.5, m: 0.27 }, echo_bike: { cal: 3.8, m: 0.11 },
  run: { m: 0.33 },
  db_front_lunge: 3.0, db_clean: 4.5, db_hang_clean: 4.0, db_snatch: 3.5, db_thruster: 3.5, db_box_step_over: 4.5, db_shoulder_to_overhead: 3.0,
  db_deadlift: 2.5, goblet_squat: 2.8, burpee_pull_up: 6.5, wall_walk: 9.0, kip_swing: 1.5,
  devil_press: 6.0, db_hang_clean_and_jerk: 3.5, db_walking_lunge: 3.0, step_up: 3.5,
  ground_to_overhead: 4.0, overhead_lunge: 3.5, ghd_sit_up: 2.2, ring_dip: 2.5, burpee_box_jump_over: 6.0, pegboard: 30,
  yoke_carry: { m: 0.6 }, bag_carry: { m: 0.5 }, farmer_carry: { m: 0.45 }, sled_pull: { m: 1.5 }, sled_push: { m: 1.0 },
  swim: { m: 1.2 }, pig_flip: 8,
  kb_swing: 2.5, wall_ball: 3.5,
  deadlift: 3.0, back_squat: 3.5, front_squat: 3.5, overhead_squat: 4.0, thruster: 3.5, clean: 5.0, hang_clean: 4.5,
  clean_and_jerk: 7.0, snatch: 5.5, hang_snatch: 5.0, shoulder_to_overhead: 3.0, bench_press: 3.0, sdhp: 3.0,
  toes_to_bar: 3.5, knees_to_elbow: 3.0, knee_to_chest: 2.5, pull_up: 2.5, chest_to_bar: 3.0, bar_muscle_up: 5.0, ring_muscle_up: 6.0,
  push_up: 2.2, hspu: 4.0, burpee: 4.5, bar_facing_burpee: 5.5, box_jump: 3.5, air_squat: 1.8, sit_up: 2.2,
  double_under: 0.6, mountain_climber: 0.8, v_up: 2.5, crunch: 1.5, lunge: 2.2, box_step_over: 3.0, broad_jump: 3.0, good_morning: 3.0, pendlay_row: 2.5, renegade_row: 3.5, kb_snatch: 3.0, ball_thruster: 2.5, plate_g2oh: 3.0, single_under: 0.35, rope_climb: 25, pistol: 3.0, handstand_walk: { m: 1.5 },
};

export function priorPace(key, unit) {
  const p = PRIOR_PACE[key];
  if (p == null) return null;
  return typeof p === 'number' ? (unit === 'reps' ? p : null) : p[unit] ?? null;
}

export function normalizeName(s) {
  return s
    .toLowerCase()
    .replace(/[()\[\],.:;!\-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 단어별 복수형 제거 (cleans → clean, snatches → snatch, unders → under). 'ss'·짧은 약어는 유지
export function singular(s) {
  return s.split(' ').map(w => {
    if (w.length > 4 && /(ch|sh|x|ss)es$/.test(w)) return w.slice(0, -2);
    return w.length > 2 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
  }).join(' ');
}

// 별칭 → key 색인. extra 는 사용자가 학습시킨 별칭 { '원문': key }
function buildIndex(extra = {}) {
  const idx = new Map();
  for (const m of MOVEMENTS) {
    for (const a of [m.name, ...m.aliases]) {
      const n = normalizeName(a);
      idx.set(n, m.key);
      idx.set(singular(n), m.key);
    }
  }
  for (const [a, key] of Object.entries(extra)) {
    if (BY_KEY[key]) {
      const n = normalizeName(a);
      idx.set(n, key);
      idx.set(singular(n), key);
    }
  }
  return idx;
}

// 색인 캐시: 사용자 별칭이 바뀔 때만 다시 만듦. 부분 일치는 긴 별칭부터 검사
let cache = { sig: null, idx: null, list: null };
function indexFor(extra) {
  const sig = JSON.stringify(extra);
  if (cache.sig !== sig) {
    const idx = buildIndex(extra);
    const list = [...idx].filter(([a]) => a.length >= 3).sort((x, y) => y[0].length - x[0].length)
      .map(([alias, key]) => [alias, key, new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}($|\\s)`)]);
    cache = { sig, idx, list };
  }
  return cache;
}

// 이름 문자열에서 운동 key 찾기. 완전 일치 → 가장 긴 별칭 포함 순으로 탐색
export function matchMovement(text, extraAliases = {}) {
  const { idx, list } = indexFor(extraAliases);
  const n = normalizeName(text);
  const cands = [n, singular(n)];
  for (const c of cands) if (idx.has(c)) return idx.get(c);
  for (const [alias, key, re] of list) {
    if (cands.some(c => c.includes(alias) && re.test(c))) return key;
  }
  return null;
}
