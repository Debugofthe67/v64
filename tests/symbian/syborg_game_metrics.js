// Benchmarks use a foreground scene with one live EGL window and no app switches.
// The GPU's map wait and the worker's round trip are wall time, not GPU timestamps.
function percentiles(samples)
{
    const sorted = samples.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return { count: sorted.length,
        median_ms: (sorted[middle] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2,
        p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

export async function measure_syborg_game(vm, renderer, api, elapsed_ms = 8000)
{
    if(api !== "gles1" && api !== "gles2") throw new Error("Choose gles1 or gles2 for the benchmark");
    const sample = async () => {
        const cpu = await vm.get_diagnostics();
        const graphics = cpu.syborg_graphics;
        const gpu = renderer?.gles?.stats;
        if(!graphics || graphics.lost || graphics.clients !== 1 || !gpu || gpu.errors.length || gpu.refused)
            throw new Error("The benchmark needs one healthy WebGPU EGL window");
        return { at: cpu.host_time, retired: cpu.cores[0].retired_instructions, graphics, gpu: window.structuredClone(gpu) };
    };
    const start = await sample();
    await new Promise(resolve => setTimeout(resolve, elapsed_ms));
    const end = await sample();
    const swaps = end.graphics[api + "_swaps"] - start.graphics[api + "_swaps"];
    const frames = end.graphics.recent_swaps.filter(frame => frame.api === api && frame.finished_ms >= start.at);
    const draws = end.gpu.draws - start.gpu.draws;
    if(frames.length < 3 || frames.length !== swaps || frames.some(frame => frame.session !== frames[0].session) ||
        end.graphics.swaps - start.graphics.swaps !== swaps || end.graphics.failed_swaps !== start.graphics.failed_swaps || !draws)
        throw new Error("The scene changed or did not produce continuous WebGPU frames in the sample window");
    return {
        api, elapsed_ms: end.at - start.at, swaps, draws,
        frame: percentiles(frames.slice(1).map((frame, index) => frame.finished_ms - frames[index].finished_ms)),
        swap_readback: percentiles(frames.map(frame => frame.readback_ms)),
        swap_readback_bytes: frames.reduce((total, frame) => total + frame.bytes, 0),
        guest_cpu_slice_ms: end.graphics.cpu_slice_ms - start.graphics.cpu_slice_ms,
        guest_retired_instructions: end.retired - start.retired,
        webgpu_queue_submits: end.gpu.queue_submits - start.gpu.queue_submits,
        webgpu_submit_cpu_ms: end.gpu.submit_cpu_ms - start.gpu.submit_cpu_ms,
        webgpu_readback_wall_ms: end.gpu.readback_wall_ms - start.gpu.readback_wall_ms,
        webgpu_readbacks: end.gpu.readbacks - start.gpu.readbacks,
    };
}
