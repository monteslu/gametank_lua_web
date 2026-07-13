-- racing: NIGHT RUN - a top-down road racer (drawn with SPRITES).
--   LEFT / RIGHT   steer        A (Z)   throttle (go faster)
-- Stay on the road and dodge the oncoming rival cars. Crash and you lose a life
-- (pips top-right) and respawn; run out and it resets. The distance bar across
-- the top fills as you drive. Music + SFX on crash.
--
-- CONTROLS: btn(0)=LEFT btn(1)=RIGHT btn(4)=A. Sprites: player=0, rivals=1,2.

local ROAD_L = 30      -- road left/right edges (x)
local ROAD_R = 96
local px = 60          -- player car x (top-left of the 8x8 sprite)
local py = 104
local lives = 3
local dist = 0         -- distance travelled (score)
local dead = 0
local scroll = 0       -- lane-dash phase
local spawn_t = 0

-- rival cars: parallel arrays
local rx = array8(4)
local ry = array8(4)
local ron = array8(4)
local rk = array8(4)   -- kind (1 or 2 -> sprite cell)

local col_grass, col_road, col_edge, col_dash, col_hud

function _init()
  music(0)
  col_grass = gt.rgb(20, 90, 30)
  col_road  = gt.rgb(30, 30, 36)
  col_edge  = gt.rgb(255, 120, 200)
  col_dash  = gt.rgb(255, 236, 39)
  col_hud   = gt.rgb(255, 255, 255)
end

function crash()
  lives -= 1
  dead = 40
  sfx(3)
  for i = 1, 4 do ron[i] = 0 end
  px = 60
  if lives < 0 then
    lives = 3
    dist = 0
  end
end

function _update60()
  if dead > 0 then
    dead -= 1
    return
  end

  -- throttle: gentle base speed, A boosts. (halved from before - it was too fast)
  local speed = 1
  if (btn(4)) speed = 2

  -- steer, then CLAMP to the road - you don't die at the edges, you just can't
  -- drive off them.
  if (btn(0)) px -= 2
  if (btn(1)) px += 2
  px = mid(ROAD_L, px, ROAD_R - 8)

  -- scroll the world (dashes) + accumulate distance
  scroll = (scroll + speed) % 16
  if (dist < 120) dist += 1

  -- move rivals down toward the player
  for i = 1, 4 do
    if ron[i] == 1 then
      ry[i] += speed
      if (ry[i] > 128) ron[i] = 0
      -- collision with the player (8x8 boxes)
      if ron[i] == 1 and rx[i] < px + 8 and rx[i] + 8 > px and ry[i] < py + 8 and ry[i] + 8 > py then
        crash()
        return
      end
    end
  end

  -- spawn a rival at the top now and then
  spawn_t += 1
  if spawn_t >= 40 then
    spawn_t = 0
    for i = 1, 4 do
      if ron[i] == 0 then
        ron[i] = 1
        rx[i] = ROAD_L + flr(rnd(ROAD_R - ROAD_L - 8))
        ry[i] = 0
        rk[i] = 1 + flr(rnd(2))
        return
      end
    end
  end
end

function _draw()
  cls(col_grass)

  -- road slab + edges
  rectfill(ROAD_L, 0, ROAD_R, 127, col_road)
  rectfill(ROAD_L - 2, 0, ROAD_L - 1, 127, col_edge)
  rectfill(ROAD_R + 1, 0, ROAD_R + 2, 127, col_edge)

  -- center lane dashes (scrolling)
  local cx = flr((ROAD_L + ROAD_R) / 2)
  for i = 0, 8 do
    local y = i * 16 + scroll - 16
    if (y >= 0 and y < 124) rectfill(cx, y, cx + 1, y + 8, col_dash)
  end

  -- rivals
  for i = 1, 4 do
    if (ron[i] == 1) spr(rk[i], rx[i], ry[i])
  end

  -- player; blink while dead
  if dead == 0 or (dead % 8) < 4 then
    spr(0, px, py)
  end

  -- HUD: distance bar (top) + life pips (top-right)
  rect(2, 2, 100, 5, col_hud)
  if (dist > 0) rectfill(3, 3, 2 + flr(dist * 96 / 120), 4, col_dash)
  for i = 1, lives do
    rectfill(104 + (i - 1) * 7, 2, 108 + (i - 1) * 7, 5, gt.rgb(41, 173, 255))
  end
end
