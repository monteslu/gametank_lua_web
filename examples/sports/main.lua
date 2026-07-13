-- sports: VOLLEY - a 2-player paddle duel (the GameTank has TWO pads).
--   P1 (left)  controller 1 up/down        P2 (right)  controller 2 up/down
-- A ball bounces between two paddles and speeds up on every hit. Miss it and the
-- other player scores. First to 7 pips (shown as a stack of blocks by each side)
-- wins - a longer flash bar marks the winner's side, then the rally resets. SFX:
-- a blip on wall bounces, a "pong" on a paddle hit, a ding when a point scores.
-- Music on the audio coprocessor.
--
-- gt-lua notes: paddles + ball are just rects redrawn each frame; the second
-- player reads btn(i, 1). Score is drawn as pips, not printed numbers; conditions
-- are boolean; array sizes are literals (there are none needed here).

local PAD_H = 26       -- paddle height
local WIN = 7          -- points to win

local p1y = 51         -- paddle tops
local p2y = 51
local bx = 62          -- ball position (integers)
local by = 60
local vx = 2           -- ball velocity
local vy = 1
local s1 = 0           -- scores
local s2 = 0
local flash = 0        -- winner-flash timer (>0 = someone just won)
local winner = 0       -- 1 = P1, 2 = P2 (drives the flash side)

local col_court, col_net, col_p1, col_p2, col_ball, col_hud

function _init()
  music(0)                            -- looping built-in tune
  col_court = gt.rgb(0, 82, 40)       -- dark green court
  col_net   = gt.rgb(255, 255, 255)   -- white net
  col_p1    = gt.rgb(41, 173, 255)    -- left paddle (cyan)
  col_p2    = gt.rgb(255, 200, 0)     -- right paddle (gold)
  col_ball  = gt.rgb(255, 255, 255)
  col_hud   = gt.rgb(255, 255, 255)
  new_match()
end

function serve(to_left)
  bx = 62  by = 60
  if to_left == 1 then vx = -2 else vx = 2 end
  if (by % 2) == 0 then vy = -1 else vy = 1 end
end

function new_match()
  p1y = 51  p2y = 51  s1 = 0  s2 = 0  flash = 0  winner = 0
  serve(1)
end

function score_point(who)
  sfx(1)                              -- ding
  if who == 1 then s1 += 1 else s2 += 1 end
  if s1 >= WIN then
    flash = 60  winner = 1
  elseif s2 >= WIN then
    flash = 60  winner = 2
  else
    if who == 1 then serve(0) else serve(1) end
  end
end

function _update60()
  if flash > 0 then
    flash -= 1
    if flash == 0 then new_match() end
    return
  end

  -- P1 on controller 0, P2 on controller 1
  if (btn(0)) p1y -= 3
  if (btn(1)) p1y += 3
  if (btn(0, 1)) p2y -= 3
  if (btn(1, 1)) p2y += 3
  p1y = mid(2, p1y, 127 - PAD_H)
  p2y = mid(2, p2y, 127 - PAD_H)

  -- ball moves
  bx += vx  by += vy

  -- top / bottom walls
  if by <= 2 then by = 2  vy = -vy  sfx(4) end
  if by >= 122 then by = 122  vy = -vy  sfx(4) end

  -- left paddle hit: reflect, speed up, add spin from contact point
  if vx < 0 and bx <= 25 and bx >= 18 and by + 5 >= p1y and by <= p1y + PAD_H then
    bx = 25
    vx = -vx + 1
    vy += (by - (p1y + PAD_H / 2)) \ 8
    sfx(0)
  end
  -- right paddle hit
  if vx > 0 and bx >= 98 and bx <= 105 and by + 5 >= p2y and by <= p2y + PAD_H then
    bx = 98
    vx = -vx - 1
    vy += (by - (p2y + PAD_H / 2)) \ 8
    sfx(0)
  end
  vx = mid(-4, vx, 4)

  -- point scored when the ball leaves a side
  if (bx < 0) score_point(2)
  if (bx > 126) score_point(1)
end

function _draw()
  cls(col_court)

  -- dashed net down the middle
  for y = 4, 120, 10 do
    rectfill(63, y, 64, y + 4, col_net)
  end

  -- paddles
  rectfill(20, p1y, 24, p1y + PAD_H, col_p1)
  rectfill(103, p2y, 107, p2y + PAD_H, col_p2)

  -- ball
  rectfill(bx, by, bx + 4, by + 4, col_ball)

  -- score pips: P1 stacks down the left, P2 down the right
  for i = 1, s1 do
    rectfill(2, 2 + (i - 1) * 7, 8, 6 + (i - 1) * 7, col_p1)
  end
  for i = 1, s2 do
    rectfill(119, 2 + (i - 1) * 7, 125, 6 + (i - 1) * 7, col_p2)
  end

  -- winner flash bar on the winning side
  if flash > 0 and (flash % 8) < 4 then
    if winner == 1 then
      rectfill(10, 58, 24, 70, col_p1)
    else
      rectfill(103, 58, 117, 70, col_p2)
    end
  end
end
