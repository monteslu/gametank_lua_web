-- platformer: HOP QUEST - run and jump across platforms.
--   d-pad L/R  move        A (Z)  jump
-- Reach the gold flag on the right to advance; touch a red spike or fall off the
-- bottom and you respawn. Gravity, ground/platform collision, coyote-ish jump.
-- SFX on jump / land / win. gt-lua: fixed-point positions, boolean conditions.

-- player (integers for pixel-perfect platforming)
local px = 8
local py = 96
local vx = 0
local vy = 0
local on_ground = 0
local face = 1
local won = 0

-- platforms: parallel byte arrays x, y, w  (each a horizontal ledge, h = 4)
-- (constant array sizes; a small hand-placed level)
local plx = array8(6)
local ply = array8(6)
local plw = array8(6)

-- spikes: x positions on the ground
local spx = array8(3)

local col_sky, col_ground, col_plat, col_player, col_spike, col_flag

function _init()
  col_sky    = gt.rgb(41, 173, 255)
  col_ground = gt.rgb(94, 62, 20)
  col_plat   = gt.rgb(0, 228, 54)
  col_player = gt.rgb(255, 236, 39)
  col_spike  = gt.rgb(255, 0, 77)
  col_flag   = gt.rgb(255, 163, 0)

  -- ledges (x, y, width)
  plx[1] = 28  ply[1] = 100 plw[1] = 24
  plx[2] = 60  ply[2] = 84  plw[2] = 20
  plx[3] = 92  ply[3] = 68  plw[3] = 24
  plx[4] = 40  ply[4] = 56  plw[4] = 18
  plx[5] = 8   ply[5] = 72  plw[5] = 16
  plx[6] = 108 ply[6] = 96  plw[6] = 18

  spx[1] = 52
  spx[2] = 74
  spx[3] = 96
end

local GROUND = 116     -- ground surface y

function respawn()
  px = 8  py = 96  vx = 0  vy = 0
  sfx(3)
end

-- is (x,y..y+7, width 6) resting on a ledge top? returns the ledge top y, or -1
function land_y(nx, ny)
  -- ground
  if ny + 8 >= GROUND then return GROUND end
  for i = 1, 6 do
    if nx + 6 > plx[i] and nx < plx[i] + plw[i] then
      local top = ply[i]
      if ny + 8 >= top and py + 8 <= top + 3 then return top end
    end
  end
  return -1
end

function _update60()
  if won > 0 then
    won -= 1
    if won == 0 then respawn() end
    return
  end

  -- horizontal
  vx = 0
  if (btn(2)) vx = -2
  if (btn(3)) vx = 2
  if (vx < 0) face = -1
  if (vx > 0) face = 1
  px += vx
  px = mid(0, px, 121)

  -- jump
  if btnp(4) and on_ground == 1 then
    vy = -6
    on_ground = 0
    sfx(0)
  end

  -- gravity + vertical move
  vy += 1
  if (vy > 6) vy = 6
  local ny = py + vy

  if vy >= 0 then
    local top = land_y(px, ny)
    if top >= 0 then
      if on_ground == 0 then sfx(1) end   -- landed
      ny = top - 8
      vy = 0
      on_ground = 1
    else
      on_ground = 0
    end
  else
    on_ground = 0
  end
  py = ny

  -- fell off the bottom?
  if (py > 130) respawn()

  -- spikes (on the ground line)
  for i = 1, 3 do
    if px + 6 > spx[i] and px < spx[i] + 6 and py + 8 >= GROUND - 1 then
      respawn()
    end
  end

  -- reached the flag (far right)?
  if px > 116 and py < 104 then
    won = 40
    sfx(1)
  end
end

function _draw()
  cls(col_sky)

  -- ground
  rectfill(0, GROUND, 127, 127, col_ground)

  -- ledges
  for i = 1, 6 do
    rectfill(plx[i], ply[i], plx[i] + plw[i] - 1, ply[i] + 3, col_plat)
  end

  -- spikes (little triangles on the ground)
  for i = 1, 3 do
    local x = spx[i]
    rectfill(x, GROUND - 4, x + 5, GROUND - 1, col_spike)
    pset(x + 2, GROUND - 5, col_spike)
  end

  -- goal flag on the right
  rectfill(122, 88, 123, 104, 7)
  rectfill(116, 88, 122, 94, col_flag)

  -- player
  rectfill(px, py, px + 5, py + 7, col_player)
  -- a little face pixel showing facing
  if face > 0 then pset(px + 4, py + 2, 0) else pset(px + 1, py + 2, 0) end

  if won > 0 then print("nice!", 48, 40, 7) end
end
