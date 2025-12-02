cmake_minimum_required(VERSION 3.1)
project(granule_growth)

find_package(BioDynaMo REQUIRED)

bdm_enable_visualization()

set(SRC src/granule_growth.cc)

bdm_create_sim_executable(granule_growth "${SRC}")