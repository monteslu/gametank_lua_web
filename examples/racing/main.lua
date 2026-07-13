-- racing: NIGHT RUN - a top-down road racer.
--   d-pad L/R  steer        A (Z)  throttle (faster = more distance, more danger)
-- Your cyan car sits at the bottom of a scrolling road. Dodge the oncoming rival
-- cars streaming down at you. Crash and you lose a life (pips, top-right) and the
-- car respawns with an explosion SFX; run out and the run resets. The distance
-- bar across the top fills as you drive - hold A to fill it faster. Music + SFX
-- on the audio coprocessor.
--
-- gt-lua notes: the "scroll" is just a phase counter - road, stripes and rivals
-- are all rects drawn at a phase-shifted y each frame (no scroll register). Score
-- is a bar, not printed numbers; conditions are boolean; array8() caps are literals.

local ROAD_X = 24      -- road left edge
local ROAD_W = 80      -- road width (playfield 24..104)

local car_x = 56       -- player car left edge
local lives = 3
local dist = 0         -- distance travelled (drives the score bar, capped)
local phase = 0        -- scroll phase for the stripes
local speed = 3        -- current speed (3 cruise, 5 on throttle)
local spawn_t = 0      -- frames until next rival spawns
local dead = 0         -- crash-blink timer

-- rivals: parallel byte arrays (literal capacities)
local rvx = array8(4)
local rvy = array8(4)
local rvc = array8(4)   -- color variant 0/1
local rvon = array8(4)  -- 1 = live

local col_grass, col_road, col_stripe, col_edge, col_car, col_win
local col_rival, col_rival2, col_hud

function _init()
  music(0)                             -- looping built-in tune
  col_grass  = gt.rgb(0, 168, 0)       -- bright roadside green
  col_road   = gt.rgb(16, 16, 24)      -- near-black asphalt
  col_stripe = gt.rgb(255, 236, 39)    -- yellow lane dashes
  col_edge   = gt.rgb(255, 255, 255)   -- white road edges
  col_car    = gt.rgb(41, 173, 255)    -- player car (cyan)
  col_win    = gt.rgb(0, 40, 80)       -- windshield
  col_rival  = gt.rgb(255, 0, 77)      -- rival red
  col_rival2 = gt.rgb(255, 0, 220)     -- rival magenta
  col_hud    = gt.rgb(255, 255, 255)
  reset_run()
end

function reset_run()
  car_x = 56  lives = 3  dist = 0  phase = 0  speed = 3  spawn_t = 0  dead = 0
  for i = 1, 4 do rvon[i] = 0 end
end

function crash()
  dead = 24
  sfx(3)                               -- explosion
  lives -= 1
  if lives < 0 then reset_run() end
end

function spawn_rival()
  for i = 1, 4 do
    if rvon[i] == 0 then
      rvon[i] = 1
      rvx[i] = ROAD_X + 6 + flr(rnd(ROAD_W - 24))
      rvy[i] = 0
      rvc[i] = flr(rnd(2))
      return
    end
  end
end

function _update60()
  if dead > 0 then
    dead -= 1
    return
  end

  -- steer, clamped to the road
  if (btn(2)) car_x -= 3
  if (btn(3)) car_x += 3
  car_x = mid(ROAD_X + 2, car_x, ROAD_X + ROAD_W - 16)

  -- throttle with A: faster = more distance but rivals come quicker
  if btn(4) then speed = 5 else speed = 3 end

  phase = (phase + speed) % 32
  if dist < 116 then dist += 1 end     -- climbs toward the full bar (cap 116)

  -- spawn rivals; faster driving spawns them sooner
  spawn_t += 1
  local gate = 36
  if (speed > 4) gate = 22
  if spawn_t >= gate then
    spawn_t = 0
    spawn_rival()
  end

  -- move rivals down; collide with the player car near the bottom
  for i = 1, 4 do
    if rvon[i] == 1 then
      rvy[i] += speed
      if rvy[i] > 124 then
        rvon[i] = 0                     -- dodged, off the bottom
      elseif rvy[i] + 20 >= 92 and rvy[i] <= 114 and abs(rvx[i] - car_x) < 14 then
        rvon[i] = 0
        crash()
      end
    end
  end
end

function _draw()
  cls(col_grass)

  -- road slab (height 127, never full 128 - the blitter drops full-dim boxes)
  rectfill(ROAD_X, 0, ROAD_X + ROAD_W - 1, 126, col_road)

  -- center lane dashes scroll by phase
  for y = 0, 127, 16 do
    local yy = (y + phase) % 128
    rectfill(ROAD_X + ROAD_W / 2 - 1, yy, ROAD_X + ROAD_W / 2, yy + 7, col_stripe)
  end

  -- white road edges
  rectfill(ROAD_X - 2, 0, ROAD_X - 1, 126, col_edge)
  rectfill(ROAD_X + ROAD_W, 0, ROAD_X + ROAD_W + 1, 126, col_edge)

  -- rivals
  for i = 1, 4 do
    if rvon[i] == 1 then
      local c = col_rival2
      if (rvc[i] == 1) c = col_rival
      rectfill(rvx[i], rvy[i], rvx[i] + 13, rvy[i] + 19, c)
    end
  end

  -- player car; blink while crashed
  if dead == 0 or (dead % 8) < 4 then
    rectfill(car_x, 92, car_x + 13, 113, col_car)
    rectfill(car_x + 3, 96, car_x + 10, 101, col_win)
  end

  -- HUD: distance bar across the top + life pips (top-right)
  rect(2, 2, 92, 5, col_hud)
  if dist > 0 then rectfill(3, 3, 2 + dist, 4, col_stripe) end
  for i = 1, lives do
    rectfill(96 + (i - 1) * 8, 2, 100 + (i - 1) * 8, 6, col_car)
  end
end
