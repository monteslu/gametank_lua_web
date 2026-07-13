-- puzzle: CHROMA WELL - a Columns-style falling-jewel matcher.
-- (a gt-lua port of Clyde Shaffer's puzzle.c GameTank example, drawn with SPRITES)
--
--   LEFT / RIGHT   move the column       DOWN   soft-drop
--   A (Z)          cycle colors up        B (X)   cycle colors down
--   START (Enter)  hard-drop / begin
--
-- A column of 3 jewels falls into an 8x13 well. Line up 3+ of one color in a
-- row, column, or diagonal to clear them; gravity pulls survivors down, which
-- can CHAIN into cascades. A NEXT preview shows the coming column. The 6 jewels
-- are 8x8 sprites (cells 0-5 of gfx.gtg).
--
-- CONTROL MAPPING (GameTank pad): btn(0)=LEFT btn(1)=RIGHT btn(2)=UP btn(3)=DOWN,
-- btn(4)=A btn(5)=B btn(6)=C btn(7)=START.

local COLS = 8
local ROWS = 13
local OX = 30          -- well left edge (px)
local OY = 16          -- well top edge (px)

local grid = array8(104)   -- 8*13, flat r*8+c: 0 empty, 1..6 jewel id
local mark = array8(104)

local p0, p1, p2 = 1, 2, 3    -- falling column, top -> bottom
local n0, n1, n2 = 4, 5, 6    -- next preview
local px = 3
local py = 0
local fall_t = 0
local move_cool = 0
local score = 0
local state = 0        -- 0 title, 1 playing, 2 game over
local flash = 0

local col_bg, col_well, col_frame, col_hud

function _init()
  music(0)
  col_bg    = gt.rgb(13, 16, 40)
  col_well  = gt.rgb(24, 24, 40)
  col_frame = gt.rgb(70, 70, 130)
  col_hud   = gt.rgb(255, 255, 255)
  roll_next()
end

function roll_next()
  n0 = 1 + flr(rnd(6))
  n1 = 1 + flr(rnd(6))
  n2 = 1 + flr(rnd(6))
end

function blocked(r, c)
  if (r >= ROWS) return 1
  if (grid[r * COLS + c] ~= 0) return 1
  return 0
end

function collides(c, topy)
  if (c < 0 or c >= COLS) return 1
  if (blocked(topy, c) == 1) return 1
  if (blocked(topy + 1, c) == 1) return 1
  if (blocked(topy + 2, c) == 1) return 1
  return 0
end

function spawn()
  p0 = n0  p1 = n1  p2 = n2
  roll_next()
  px = 3
  py = 0
  fall_t = 0
end

function reset_game()
  for i = 0, 103 do grid[i] = 0 end
  score = 0  fall_t = 0  move_cool = 0
  roll_next()
  spawn()
end

-- walk a run from its start; if 3+ long, flag every cell.
function scan_run(r, c, col, dr, dc)
  local sr = r - dr
  local sc = c - dc
  if sr >= 0 and sr < ROWS and sc >= 0 and sc < COLS and grid[sr * COLS + sc] == col then
    return
  end
  local len = 1
  sr = r + dr
  sc = c + dc
  while sr >= 0 and sr < ROWS and sc >= 0 and sc < COLS and grid[sr * COLS + sc] == col do
    len += 1  sr += dr  sc += dc
  end
  if len >= 3 then
    sr = r  sc = c
    for k = 1, len do
      mark[sr * COLS + sc] = 1
      sr += dr  sc += dc
    end
  end
end

-- flag all 3+ runs in 4 directions; return count flagged.
function mark_matches()
  for i = 0, 103 do mark[i] = 0 end
  for r = 0, ROWS - 1 do
    for c = 0, COLS - 1 do
      local col = grid[r * COLS + c]
      if col ~= 0 then
        scan_run(r, c, col, 0, 1)    -- horizontal
        scan_run(r, c, col, 1, 0)    -- vertical
        scan_run(r, c, col, 1, 1)    -- diagonal
        scan_run(r, c, col, 1, -1)   -- anti-diagonal
      end
    end
  end
  local cnt = 0
  for i = 0, 103 do
    if (mark[i] ~= 0) cnt += 1
  end
  return cnt
end

function apply_gravity()
  for c = 0, COLS - 1 do
    local w = ROWS - 1
    for r = ROWS - 1, 0, -1 do
      local v = grid[r * COLS + c]
      if v ~= 0 then
        grid[w * COLS + c] = v
        if (w ~= r) grid[r * COLS + c] = 0
        w -= 1
      end
    end
    while w >= 0 do
      grid[w * COLS + c] = 0
      w -= 1
    end
  end
end

function resolve_board()
  local chain = 0
  while true do
    local n = mark_matches()
    if (n == 0) break
    chain += 1
    for i = 0, 103 do
      if (mark[i] ~= 0) grid[i] = 0
    end
    local gain = n * 10
    if (chain > 1) gain = n * 10 * chain
    score += gain
    if (score > 999) score = 999
    sfx(1)
    apply_gravity()
  end
end

function lock_piece()
  if (py < ROWS)     grid[py * COLS + px] = p0
  if (py + 1 < ROWS) grid[(py + 1) * COLS + px] = p1
  if (py + 2 < ROWS) grid[(py + 2) * COLS + px] = p2
  sfx(3)
  resolve_board()
end

function game_over()
  state = 2
  flash = 120
end

function _update60()
  if state ~= 1 then
    if (flash > 0) flash -= 1
    if btnp(7) or btnp(4) then
      reset_game()
      state = 1
    end
    return
  end

  -- horizontal move (btn 0 = LEFT, btn 1 = RIGHT), with a small cooldown
  if (move_cool > 0) move_cool -= 1
  if move_cool == 0 then
    if btn(0) and collides(px - 1, py) == 0 then
      px -= 1  move_cool = 6  sfx(0)
    end
    if btn(1) and collides(px + 1, py) == 0 then
      px += 1  move_cool = 6  sfx(0)
    end
  end

  -- cycle colors: A up, B down
  if btnp(4) then
    local t = p0  p0 = p1  p1 = p2  p2 = t  sfx(1)
  end
  if btnp(5) then
    local t = p2  p2 = p1  p1 = p0  p0 = t  sfx(1)
  end

  -- hard drop on START
  if btnp(7) then
    while collides(px, py + 1) == 0 do py += 1 end
    lock_piece()
    spawn()
    if (collides(px, py) == 1) game_over()
    fall_t = 0
  end

  -- gravity: one row every ~28 frames (about half a second); DOWN soft-drops fast
  fall_t += 1
  local step = 28
  if (btn(3)) step = 4
  if fall_t >= step then
    fall_t = 0
    if collides(px, py + 1) == 1 then
      lock_piece()
      spawn()
      if (collides(px, py) == 1) game_over()
    else
      py += 1
    end
  end
end

function _draw()
  cls(col_bg)

  if state == 0 then
    print("chroma well", 30, 22, col_hud)
    for i = 0, 5 do
      spr(i, 26 + i * 12, 58)
    end
    print("press start", 32, 92, col_hud)
    return
  end

  -- well frame + interior
  rectfill(OX - 2, OY - 2, OX + COLS * 8 + 1, OY + ROWS * 8 + 1, col_frame)
  rectfill(OX, OY, OX + COLS * 8 - 1, OY + ROWS * 8 - 1, col_well)

  -- locked jewels
  for r = 0, ROWS - 1 do
    for c = 0, COLS - 1 do
      local v = grid[r * COLS + c]
      if (v ~= 0) spr(v - 1, OX + c * 8, OY + r * 8)
    end
  end

  -- the falling column
  if state == 1 then
    if (py < ROWS)     spr(p0 - 1, OX + px * 8, OY + py * 8)
    if (py + 1 < ROWS) spr(p1 - 1, OX + px * 8, OY + (py + 1) * 8)
    if (py + 2 < ROWS) spr(p2 - 1, OX + px * 8, OY + (py + 2) * 8)
  end

  -- NEXT preview to the right of the well
  print("next", 100, 18, col_hud)
  spr(n0 - 1, 104, 26)
  spr(n1 - 1, 104, 34)
  spr(n2 - 1, 104, 42)

  -- score bar across the top-left
  rect(2, 3, 27, 7, col_hud)
  if (score > 0) rectfill(3, 4, 3 + flr(score / 40), 6, gt.rgb(0, 228, 54))

  if state == 2 then
    if flash % 20 < 12 then
      print("game over", 36, 54, col_hud)
      print("press start", 32, 70, col_hud)
    end
  end
end
