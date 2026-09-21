import { dtoa, dtoa_buffered } from "util/number";
const BUFFER = memory.data(128);
const INPUT = memory.data(256);
export function input(): usize { return INPUT; }
export function run64Buffered(ptr: usize, count: i32, reps: i32): i32 {
  let sum = 0;
  for (let j = 0; j < reps; ++j) for (let i = 0; i < count; ++i)
    sum += dtoa_buffered<f64>(BUFFER, load<f64>(ptr + (<usize>i << 3)));
  return sum;
}
export function run32Buffered(ptr: usize, count: i32, reps: i32): i32 {
  let sum = 0;
  for (let j = 0; j < reps; ++j) for (let i = 0; i < count; ++i)
    sum += dtoa_buffered<f32>(BUFFER, load<f32>(ptr + (<usize>i << 2)));
  return sum;
}
export function run64Alloc(ptr: usize, count: i32, reps: i32): i32 {
  let sum = 0;
  for (let j = 0; j < reps; ++j) for (let i = 0; i < count; ++i)
    sum += dtoa<f64>(load<f64>(ptr + (<usize>i << 3))).length;
  return sum;
}
export function run32Alloc(ptr: usize, count: i32, reps: i32): i32 {
  let sum = 0;
  for (let j = 0; j < reps; ++j) for (let i = 0; i < count; ++i)
    sum += dtoa<f32>(load<f32>(ptr + (<usize>i << 2))).length;
  return sum;
}
