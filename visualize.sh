#!/bin/bash
set -e

# Load BioDynaMo environment (update path to match your install)
if [ -f ~/biodynamo-v1.05.0/bin/thisbdm.sh ]; then
    source ~/biodynamo-v1.05.0/bin/thisbdm.sh
else
    echo "ERROR: Modify run_and_view.sh with the correct BioDynaMo install path."
    exit 1
fi

# Build project
echo "=== Building granule_growth project ==="
mkdir -p build
cd build
cmake ..
make -j4

echo "=== Running simulation ==="
./granule_growth

cd ..

# Find newest VTK directory under output/
latest_output=$(ls -td output/* | head -n 1)

echo "Latest output: $latest_output"

# Open ParaView if installed
if command -v paraview >/dev/null 2>&1; then
    echo "Opening ParaView..."
    paraview "$latest_output" &
else
    echo "ParaView not found. Install from https://www.paraview.org/"
    echo "VTK output stored in: $latest_output"
fi