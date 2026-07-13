-- sports: VOLLEY - a 2-player paddle duel (the GameTank has TWO pads).
--   P1 (left paddle)  controller 1 UP/DOWN     P2 (right)  controller 2 UP/DOWN
-- The ball bounces between the paddles and speeds up on every hit. Miss it and
-- the other player scores; first to 7 (pips by each side) wins, then it resets.
-- The ball is an 8x8 sprite; paddles are bars. SFX on wall / paddle / point.
--
-- CONTROLS: btn(2)=UP btn(3)=DOWN. Player 2 reads controller 1: btn(2, 1) etc.

local p1y = 52         -- paddle top y (16 tall)
local p2y = 52
local PH = 20          -- paddle height
local bx = 62          -- ball top-left
local by = 60
local vx = 1           -- ball velocity (slower than before)
local vy = 1
local s1 = 0           -- scores
local s2 = 0
local serve = 30       -- countdown before the ball moves after a point
local win = 0          -- 0 none, 1 P1, 2 P2 (flash)
local p2_human = 0     -- becomes 1 the first time P2 presses a button; else AI
local btick = 0        -- ball clock: the ball only steps on some frames (pacing)

local col_court, col_net, col_p1, col_p2, col_hud

function _init()
  music(0)
  col_court = gt.rgb(0, 60, 40)
  col_net   = gt.rgb(255, 119, 168)
  col_p1    = gt.rgb(41, 173, 255)
  col_p2    = gt.rgb(255, 163, 0)
  col_hud   = gt.rgb(255, 255, 255)
end

function reset_ball(dir)
  bx = 62
  by = 60
  vx = dir
  vy = 1
  if (rnd(2) < 1) vy = -1
  serve = 30
end

function point(who)
  sfx(1)
  if who == 1 then
    s1 += 1
    if s1 >= 7 then win = 1  win_t() end
    reset_ball(1)
  else
    s2 += 1
    if s2 >= 7 then win = 2  win_t() end
    reset_ball(-1)
  end
end

function win_t()
  serve = 120
end

function _update60()
  if win ~= 0 then
    serve -= 1
    if serve <= 0 then
      s1 = 0  s2 = 0  win = 0
      reset_ball(1)
    end
    return
  end

  -- paddles: P1 on controller 0 (up = btn 2, down = btn 3)
  if (btn(2)) p1y -= 2
  if (btn(3)) p1y += 2

  -- P2 on controller 1 - but if no one's touched it, the computer plays (AI).
  -- The first P2 button press flips to human control.
  if btn(2, 1) or btn(3, 1) then p2_human = 1 end
  if p2_human == 1 then
    if (btn(2, 1)) p2y -= 2
    if (btn(3, 1)) p2y += 2
  else
    -- AI: ease the paddle center toward the ball (a bit laggy so it's beatable)
    local target = by - (PH - 8) / 2
    if p2y < target - 1 then p2y += 2 end
    if p2y > target + 1 then p2y -= 2 end
  end

  p1y = mid(2, p1y, 126 - PH)
  p2y = mid(2, p2y, 126 - PH)

  if serve > 0 then
    serve -= 1
    return
  end

  -- ball moves every OTHER frame so it's a comfortable speed (was every frame)
  btick += 1
  if (btick % 2 ~= 0) return
  bx += vx
  by += vy

  -- top/bottom walls
  if by < 2 then by = 2  vy = -vy  sfx(4) end
  if by > 118 then by = 118  vy = -vy  sfx(4) end

  -- left paddle (x 6..9) - hit if the ball reaches it and overlaps vertically
  if vx < 0 and bx <= 10 and bx > 4 and by + 8 > p1y and by < p1y + PH then
    vx = -vx
    -- add spin from where it hit the paddle
    local hit = (by + 4) - (p1y + 10)
    vy = mid(-2, flr(hit / 8) + vy, 2)
    if (vx < 2) vx += 1
    sfx(0)
  end
  -- right paddle (x 118..121)
  if vx > 0 and bx + 8 >= 118 and bx + 8 < 124 and by + 8 > p2y and by < p2y + PH then
    vx = -vx
    local hit = (by + 4) - (p2y + 10)
    vy = mid(-2, flr(hit / 8) + vy, 2)
    if (vx > -2) vx -= 1
    sfx(0)
  end

  -- missed?
  if (bx < -8) point(2)
  if (bx > 128) point(1)
end

function _draw()
  cls(col_court)

  -- net (dashed center)
  for i = 0, 15 do
    rectfill(63, i * 8 + 1, 64, i * 8 + 5, col_net)
  end

  -- paddles
  rectfill(6, p1y, 9, p1y + PH - 1, col_p1)
  rectfill(118, p2y, 121, p2y + PH - 1, col_p2)

  -- ball (sprite)
  spr(0, bx, by)

  -- scores as pip stacks near each side
  for i = 1, s1 do
    rectfill(14, 4 + (i - 1) * 8, 20, 9 + (i - 1) * 8, col_p1)
  end
  for i = 1, s2 do
    rectfill(107, 4 + (i - 1) * 8, 113, 9 + (i - 1) * 8, col_p2)
  end

  if win == 1 then
    if (serve % 16 < 10) print("p1 wins", 34, 60, col_p1)
  end
  if win == 2 then
    if (serve % 16 < 10) print("p2 wins", 34, 60, col_p2)
  end
end
