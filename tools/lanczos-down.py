#!/usr/bin/env python3
import sys
from PIL import Image, ImageFilter
src, dest, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
im = Image.open(src).convert('RGB')
out = im.resize((w, h), Image.Resampling.LANCZOS)
out = out.filter(ImageFilter.UnsharpMask(radius=0.6, percent=40, threshold=2))
out.save(dest)
print(dest, out.size)
