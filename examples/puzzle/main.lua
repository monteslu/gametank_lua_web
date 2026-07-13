-- puzzle: DROP STACK - a falling-block line clearer.
--   d-pad L/R  move the piece    d-pad down  soft-drop    A (Z)  cycle color
-- A colored block falls; land it, and when a ROW across the well is full it
-- clears and everything above drops. Fill the well and it resets. SFX on
-- land / clear. gt-lua: a byte grid (0 = empty, else a color id 1..4).

-- well is 8 cols x 12 rows of 12x8-px cells, centered
local COLS = 8
local ROWS = 12
local CELLW = 12
local CELLH = 8
local OX = 16          -- origin x (well left)
local OY = 20          -- origin y (well top)

-- grid[row*COLS + col] as a byte array (0 empty, 1..4 = color)
local grid = array8(96)   -- 8*12

-- the falling piece
local pcol = 0         -- current column
local prow = 0         -- current row (top)
local pc = 1           -- color id 1..4
local fall = 0         -- fall tick

local pal = array8(5)  -- color id -> gt byte

function _init()
  pal[1] = gt.rgb(255, 0, 77)     -- red
  pal[2] = gt.rgb(255, 236, 39)   -- yellow
  pal[3] = gt.rgb(0, 228, 54)     -- green
  pal[4] = gt.rgb(41, 173, 255)   -- blue
  new_piece()
end

function new_piece()
  pcol = 3
  prow = 0
  pc = 1 + flr(rnd(4))
  fall = 0
  -- game over if the spawn cell is taken -> clear the well
  if grid[pcol] ~= 0 then
    for i = 0, 95 do grid[i] = 0 end
  end
end

-- can the piece occupy (c, r)? returns 1 (free) or 0 (blocked)
function free(c, r)
  if (c < 0 or c >= COLS or r >= ROWS) return 0
  if (r < 0) return 1
  if (grid[r * COLS + c] == 0) return 1
  return 0
end

function lock_piece()
  grid[prow * COLS + pcol] = pc
  sfx(1)
  clear_rows()
  new_piece()
end

function clear_rows()
  for r = ROWS - 1, 0, -1 do
    local full = 1
    for c = 0, COLS - 1 do
      if (grid[r * COLS + c] == 0) full = 0
    end
    if full == 1 then
      sfx(0)
      -- drop everything above row r down by one
      for rr = r, 1, -1 do
        for c = 0, COLS - 1 do
          grid[rr * COLS + c] = grid[(rr - 1) * COLS + c]
        end
      end
      for c = 0, COLS - 1 do grid[c] = 0 end
    end
  end
end

function _update60()
  if btnp(2) and free(pcol - 1, prow) == 1 then pcol -= 1 end
  if btnp(3) and free(pcol + 1, prow) == 1 then pcol += 1 end
  if (btnp(4)) pc = 1 + (pc % 4)

  -- soft drop with down held, else timed fall
  fall += 1
  local step = 24
  if (btn(1)) step = 4
  if fall >= step then
    fall = 0
    if free(pcol, prow + 1) == 1 then
      prow += 1
    else
      lock_piece()
    end
  end
end

function _draw()
  cls(1)

  -- well frame
  rect(OX - 1, OY - 1, OX + COLS * CELLW, OY + ROWS * CELLH, 7)

  -- settled blocks
  for r = 0, ROWS - 1 do
    for c = 0, COLS - 1 do
      local v = grid[r * COLS + c]
      if v ~= 0 then
        local x = OX + c * CELLW
        local y = OY + r * CELLH
        rectfill(x, y, x + CELLW - 2, y + CELLH - 2, pal[v])
      end
    end
  end

  -- the falling piece
  local x = OX + pcol * CELLW
  local y = OY + prow * CELLH
  rectfill(x, y, x + CELLW - 2, y + CELLH - 2, pal[pc])
  rect(x, y, x + CELLW - 2, y + CELLH - 2, 7)
end
