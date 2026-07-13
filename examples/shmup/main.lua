-- shmup: STARFALL - a vertical space shooter (drawn with SPRITES).
--   LEFT / RIGHT / UP / DOWN   fly your ship        A (Z)   fire
-- Shoot the descending invaders before they reach the bottom. Get hit and you
-- lose a life (the pips top-left); clear a wave and a harder one spawns. Music +
-- SFX on the audio coprocessor.
--
-- CONTROLS (GameTank pad): btn(0)=LEFT btn(1)=RIGHT btn(2)=UP btn(3)=DOWN,
-- btn(4)=A. Sprites: ship=cell 0, invader=cell 1, bullet=cell 2, boom=cell 3.

local px = 60          -- player x, y (top-left of the 8x8 ship)
local py = 108
local lives = 3
local score = 0
local dead = 0         -- death-blink timer
local wave = 1
local cool = 0         -- fire cooldown
local etick = 0        -- enemy movement clock (slows their drift)

local bx = array8(8)   -- bullets
local by = array8(8)
local bon = array8(8)

local ex = array8(10)  -- enemies
local ey = array8(10)
local eon = array8(10)
local et = array8(10)  -- wiggle phase
local eb = array8(10)  -- boom timer (>0 = exploding, not live)

local col_bg, col_hud, col_bar

function _init()
  music(0)
  col_bg  = gt.rgb(10, 10, 26)
  col_hud = gt.rgb(255, 255, 255)
  col_bar = gt.rgb(255, 236, 39)
  spawn_wave()
end

function spawn_wave()
  local n = 3 + wave
  if (n > 10) n = 10
  for i = 1, 10 do
    if i <= n then
      eon[i] = 1
      ex[i] = 8 + flr(rnd(104))
      ey[i] = flr(rnd(18)) + 2
      et[i] = flr(rnd(64))
      eb[i] = 0
    else
      eon[i] = 0
      eb[i] = 0
    end
  end
end

function fire()
  for i = 1, 8 do
    if bon[i] == 0 then
      bon[i] = 1
      bx[i] = px
      by[i] = py - 4
      sfx(0)
      return
    end
  end
end

function hurt()
  lives -= 1
  dead = 40
  sfx(3)
  if lives < 0 then
    lives = 3
    score = 0
    wave = 1
    spawn_wave()
  end
end

function _update60()
  -- tick enemy explosions regardless of player state
  for i = 1, 10 do
    if (eb[i] > 0) eb[i] -= 1
  end

  if dead > 0 then
    dead -= 1
    return
  end

  -- move (1 px/frame = a controllable ~60px/sec)
  if (btn(0)) px -= 1
  if (btn(1)) px += 1
  if (btn(2)) py -= 1
  if (btn(3)) py += 1
  px = mid(0, px, 120)
  py = mid(40, py, 119)

  -- fire (A), with a short cooldown so held-A doesn't spam
  if (cool > 0) cool -= 1
  if btn(4) and cool == 0 then
    fire()
    cool = 8
  end

  -- bullets rise
  for i = 1, 8 do
    if bon[i] == 1 then
      by[i] -= 3
      if (by[i] < 2) bon[i] = 0
    end
  end

  -- enemies drift down GENTLY: one pixel every 4 frames (~15 px/sec, ~8s to
  -- cross the screen) so you have time to aim, plus a slow sideways sway.
  etick += 1
  local step_down = 0
  if (etick % 4 == 0) step_down = 1
  local alive = 0
  for i = 1, 10 do
    if eon[i] == 1 then
      alive += 1
      et[i] = (et[i] + 1) % 128
      ey[i] += step_down
      -- sway ~1px every 4 frames (half the row is drift-right, half drift-left)
      if etick % 4 == 0 then
        if et[i] < 64 then ex[i] += 1 else ex[i] -= 1 end
      end
      ex[i] = mid(2, ex[i], 118)

      if ey[i] > 120 then
        eon[i] = 0
        hurt()
      end

      -- bullet hit?
      for j = 1, 8 do
        if bon[j] == 1 and bx[j] + 2 >= ex[i] and bx[j] <= ex[i] + 7 and by[j] <= ey[i] + 7 and by[j] + 4 >= ey[i] then
          eon[i] = 0
          eb[i] = 10          -- start explosion
          bon[j] = 0
          if (score < 100) score += 5
          sfx(1)
        end
      end

      -- enemy touches player?
      if eon[i] == 1 and ex[i] < px + 8 and ex[i] + 8 > px and ey[i] < py + 8 and ey[i] + 8 > py then
        eon[i] = 0
        eb[i] = 10
        hurt()
      end
    end
  end

  if alive == 0 then
    wave += 1
    spawn_wave()
  end
end

function _draw()
  cls(col_bg)

  -- enemies + explosions
  for i = 1, 10 do
    if (eon[i] == 1) spr(1, ex[i], ey[i])
    if (eb[i] > 0) spr(3, ex[i], ey[i])
  end

  -- bullets
  for i = 1, 8 do
    if (bon[i] == 1) spr(2, bx[i], by[i])
  end

  -- player ship; blink while dead
  if dead == 0 or (dead % 8) < 4 then
    spr(0, px, py)
  end

  -- HUD: life pips + score bar
  for i = 1, lives do
    rectfill(2 + (i - 1) * 6, 2, 6 + (i - 1) * 6, 5, gt.rgb(41, 173, 255))
  end
  rect(34, 2, 125, 5, col_hud)
  if (score > 0) rectfill(35, 3, 34 + score, 4, col_bar)
end
