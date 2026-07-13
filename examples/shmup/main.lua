-- shmup: STARFALL - a vertical space shooter.
--   d-pad  move your ship          A (Z)  fire
-- Shoot the descending invaders before they reach the bottom. Get hit and you
-- lose a life (the pips top-left); clear a wave and a harder one spawns. Music
-- + SFX on the audio coprocessor. A complete little arcade game.
--
-- gt-lua notes worth knowing: array8(n) needs a CONSTANT size, conditions must
-- be boolean, and there's no runtime string building - so the HUD is drawn with
-- shapes (life pips + a score bar), not printed numbers.

local px = 60          -- player x, y
local py = 108
local lives = 3
local score = 0
local dead = 0         -- death-blink timer
local wave = 1

-- player bullets (parallel byte arrays; capacities are literals)
local bx = array8(8)
local by = array8(8)
local bon = array8(8)   -- 1 = live

-- enemies
local ex = array8(12)
local ey = array8(12)
local eon = array8(12)
local et = array8(12)   -- wiggle phase

local col_ship, col_bull, col_enemy, col_bg, col_hud

function _init()
  music(0)                          -- looping built-in tune
  col_ship  = gt.rgb(41, 173, 255)  -- blue
  col_bull  = gt.rgb(255, 236, 39)  -- yellow
  col_enemy = gt.rgb(255, 0, 77)    -- red
  col_bg    = gt.rgb(13, 16, 28)    -- near-black space
  col_hud   = gt.rgb(255, 255, 255)
  spawn_wave()
end

function spawn_wave()
  local n = min(12, 4 + wave)
  for i = 1, n do
    eon[i] = 1
    ex[i] = 8 + flr(rnd(110))
    ey[i] = flr(rnd(20)) + 4
    et[i] = flr(rnd(64))
  end
end

function fire()
  for i = 1, 8 do
    if bon[i] == 0 then
      bon[i] = 1
      bx[i] = px + 4
      by[i] = py
      sfx(0)                         -- pew
      return
    end
  end
end

function hurt()
  lives -= 1
  dead = 30
  sfx(3)                            -- explosion
  if lives < 0 then
    lives = 3
    score = 0
    wave = 1
    spawn_wave()
  end
end

function _update60()
  if dead > 0 then
    dead -= 1
    return
  end

  -- move
  if (btn(2)) px -= 2
  if (btn(3)) px += 2
  if (btn(0)) py -= 2
  if (btn(1)) py += 2
  px = mid(0, px, 119)
  py = mid(40, py, 118)
  if (btnp(4)) fire()

  -- bullets travel up
  for i = 1, 8 do
    if bon[i] == 1 then
      by[i] -= 4
      if by[i] < 2 then bon[i] = 0 end
    end
  end

  -- enemies drift down and wiggle
  local alive = 0
  for i = 1, 12 do
    if eon[i] == 1 then
      alive += 1
      et[i] = (et[i] + 1) % 64
      ey[i] += 1
      if et[i] < 32 then ex[i] += 1 else ex[i] -= 1 end
      ex[i] = mid(2, ex[i], 122)

      if ey[i] > 120 then
        eon[i] = 0
        hurt()
      end

      -- bullet hits enemy?
      for j = 1, 8 do
        if bon[j] == 1 and bx[j] >= ex[i] - 1 and bx[j] <= ex[i] + 6 and by[j] >= ey[i] - 1 and by[j] <= ey[i] + 6 then
          eon[i] = 0
          bon[j] = 0
          if score < 120 then score += 4 end
          sfx(1)                     -- boom
        end
      end

      -- enemy hits player?
      if eon[i] == 1 and ex[i] < px + 8 and ex[i] + 6 > px and ey[i] < py + 8 and ey[i] + 6 > py then
        eon[i] = 0
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

  for i = 1, 12 do
    if eon[i] == 1 then
      rectfill(ex[i], ey[i], ex[i] + 6, ey[i] + 6, col_enemy)
      pset(ex[i] + 2, ey[i] + 2, 0)
      pset(ex[i] + 4, ey[i] + 2, 0)
    end
  end

  for i = 1, 8 do
    if bon[i] == 1 then
      rectfill(bx[i], by[i], bx[i] + 1, by[i] + 3, col_bull)
    end
  end

  -- player ship; blink while dead
  if dead == 0 or (dead % 8) < 4 then
    rectfill(px, py + 3, px + 7, py + 7, col_ship)
    rectfill(px + 3, py, px + 4, py + 7, col_ship)
  end

  -- HUD: life pips (top-left) + a score bar (top)
  for i = 1, lives do
    rectfill(2 + (i - 1) * 6, 2, 6 + (i - 1) * 6, 5, col_ship)
  end
  rect(30, 2, 125, 5, col_hud)
  if score > 0 then rectfill(31, 3, 30 + score, 4, col_bull) end
end
