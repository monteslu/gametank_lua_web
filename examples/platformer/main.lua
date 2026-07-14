-- platformer: HOP QUEST - run and jump across a scrolling world.
--   d-pad L/R  move        A (Z)  jump
-- The level is three screens wide (384px); camera() follows the hero. Reach
-- the gold flag at the far right; touch a red spike or fall off the bottom and
-- you respawn. Gravity, ground/platform collision, coyote-ish jump. SFX on
-- jump / land / win, plus background music. The hero is an 8x8 sprite (cell 0
-- faces right, cell 1 faces left). gt-lua: integer positions, boolean
-- conditions.

-- Draws the hero with sprf() (the gfx.gsi frame table): frame 0 faces
-- right, frame 1 faces left. Each frame is cropped to the hero's true size
-- (not a padded 8x8 cell), which is the point of a frame table.

-- player (integers for pixel-perfect platforming)
local px = 8
local py = 96
local vx = 0
local vy = 0
local on_ground = 0
local face = 1
local won = 0

-- the world is 3 screens wide; the camera follows the hero across it
local WORLD = 384

-- platforms: parallel arrays x, y, w (each a horizontal ledge, h = 4).
-- x is a full int (world coords go past 255); y/w fit bytes.
local plx = array(13)
local ply = array8(13)
local plw = array8(13)

-- spikes: x positions on the ground (world coords, so ints)
local spx = array(10)

local col_sky, col_ground, col_plat, col_spike, col_flag

function _init()
  music(0)
  col_sky    = gt.rgb(41, 173, 255)
  col_ground = gt.rgb(94, 62, 20)
  col_plat   = gt.rgb(0, 228, 54)
  col_spike  = gt.rgb(255, 0, 77)
  col_flag   = gt.rgb(255, 163, 0)

  -- ledges (x, y, width) - screen 1 teaches, 2 and 3 stretch the hops
  plx[1] = 28   ply[1] = 100 plw[1] = 24
  plx[2] = 60   ply[2] = 84  plw[2] = 20
  plx[3] = 92   ply[3] = 68  plw[3] = 24
  plx[4] = 40   ply[4] = 56  plw[4] = 18
  plx[5] = 8    ply[5] = 72  plw[5] = 16
  plx[6] = 108  ply[6] = 96  plw[6] = 18
  plx[7] = 140  ply[7] = 100 plw[7] = 20
  plx[8] = 172  ply[8] = 84  plw[8] = 20
  plx[9] = 204  ply[9] = 96  plw[9] = 18
  plx[10] = 236 ply[10] = 76 plw[10] = 20
  plx[11] = 268 ply[11] = 92 plw[11] = 18
  plx[12] = 296 ply[12] = 72 plw[12] = 20
  plx[13] = 330 ply[13] = 88 plw[13] = 22

  spx[1] = 52
  spx[2] = 74
  spx[3] = 96
  spx[4] = 160
  spx[5] = 196
  spx[6] = 228
  spx[7] = 262
  spx[8] = 290
  spx[9] = 320
  spx[10] = 352
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
  for i = 1, 13 do
    if nx + 6 > plx[i] and nx < plx[i] + plw[i] then
      local top = ply[i]
      if ny + 8 >= top and py + 8 <= top + 3 then return top end
    end
  end
  return -1
end

function _update()
  if won > 0 then
    won -= 1
    if won == 0 then respawn() end
    return
  end

  -- horizontal (btn(0)=LEFT, btn(1)=RIGHT - NOT up/down)
  vx = 0
  if (btn(0)) vx = -2
  if (btn(1)) vx = 2
  if (vx < 0) face = -1
  if (vx > 0) face = 1
  px += vx
  px = mid(0, px, WORLD - 7)

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
  for i = 1, 10 do
    if px + 6 > spx[i] and px < spx[i] + 6 and py + 8 >= GROUND - 1 then
      respawn()
    end
  end

  -- reached the flag (far right of the world)?
  if px > WORLD - 18 and py < 104 then
    won = 40
    sfx(1)
  end
end

function _draw()
  cls(col_sky)

  -- camera: keep the hero about a third in from the left, clamped to the
  -- world edges; every draw below is in WORLD coordinates
  local camx = mid(0, px - 44, WORLD - 128)
  camera(camx, 0)

  -- ground (just the visible strip)
  rectfill(camx, GROUND, camx + 127, 127, col_ground)

  -- ledges (skip the ones entirely off-screen)
  for i = 1, 13 do
    if plx[i] + plw[i] > camx and plx[i] < camx + 128 then
      rectfill(plx[i], ply[i], plx[i] + plw[i] - 1, ply[i] + 3, col_plat)
    end
  end

  -- spikes (little triangles on the ground)
  for i = 1, 10 do
    local x = spx[i]
    if x + 6 > camx and x < camx + 128 then
      rectfill(x, GROUND - 4, x + 5, GROUND - 1, col_spike)
      pset(x + 2, GROUND - 5, col_spike)
    end
  end

  -- goal flag at the far right of the world
  rectfill(WORLD - 6, 88, WORLD - 5, 104, 7)
  rectfill(WORLD - 12, 88, WORLD - 6, 94, col_flag)

  -- player: 8x8 sprite, cell 0 faces right / cell 1 faces left
  if face > 0 then sprf(0, px, py) else sprf(1, px, py) end

  -- HUD text is screen-space: reset the camera before printing
  camera()
  if won > 0 then print("nice!", 48, 40, 7) end
end
