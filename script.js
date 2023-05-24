async function main() {

    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error('need a browser that supports WebGPU');

    const canvas = document.querySelector('canvas');
    const zoom = 16;
    canvas.width  = canvas.clientWidth  / zoom;
    canvas.height = canvas.clientHeight / zoom;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });



    const lineWgsl = `
    @group(0) @binding(0) var<uniform> canvas: vec2f;

    @vertex fn main_vertex(@location(0) pos: vec2f) -> @builtin(position) vec4f {
        return vec4f(pos*2.0/canvas, 0.0, 1.0);
    }

    @fragment fn main_fragment() -> @location(0) vec4f {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    `;

    const module = device.createShaderModule({
        label: "it's a shader!",
        code: wgsl,
    });



    const blurWgsl = `
    @group(0) @binding(0) var frame: texture_2d;
    @group(0) @binding(1) var frame_sampler: sampler;

    @fragment fn main() -> @location(0) vec4f {
        return vec4f(0.5, 0.5, 0.0, 1.0);
    }
    `;

    const blurModule = device.createShaderModule({
        label: "blur shader",
        code: blurWgsl,
    });



    const pipeline = device.createRenderPipeline({
        label: "it's a pipeline!",
        layout: 'auto',
        primitive: {
            topology: "line-list",
        },
        vertex: {
            module,
            entryPoint: 'main_vertex',
            buffers: [{
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: "float32x2",
                }]
            }]
        },
        fragment: {
            module,
            entryPoint: 'main_fragment',
            targets: [{ format: canvasFormat }],
        },
    });



    // Canvas size buffer.
    const canvasBuffer = device.createBuffer({
        label: "canvas size buffer",
        size: 2*2*4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        canvasBuffer, 0,
        new Float32Array([canvas.width, canvas.height])
    );



    const bindGroup = device.createBindGroup({
        label: "bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [{binding: 0, resource: {buffer: canvasBuffer}}]
    });

    const vertexBuffer = device.createBuffer({
        label: "vertex buffer",
        size: 2*2*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });



    function render() {

        const encoder = device.createCommandEncoder({ label: 'encoder' });
        const pass = encoder.beginRenderPass({
            label: 'render pass',
            colorAttachments: [
                { // We're rendering to the canvas's current texture.
                    view: context.getCurrentTexture().createView(),
                    clearValue: [1.0, 1.0, 1.0, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setBindGroup(0, bindGroup);
        pass.draw(2);
        pass.end();

        device.queue.submit([encoder.finish()]);
    }



    // Stateful things.
    let cornerA = [0, 0];
    let cornerB = [0, 0];
    let frame = 0;

    function update() {
        cornerA[0] = 7 * Math.sin( frame/Math.PI/16);
        cornerA[1] = 7 * Math.cos( frame/Math.PI/16);
        cornerB[0] = 7 * Math.sin(-frame/Math.PI/32)*1.01;
        cornerB[1] = 7 * Math.cos(-frame/Math.PI/32)*1.01;
        device.queue.writeBuffer(vertexBuffer, 0, new Float32Array(cornerA.concat(cornerB)));
        ++frame;
    }

    function loop() {
        update();
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}

// Prevent Edge's context menu.
window.onmouseup = event => event.preventDefault();

main().catch(err => console.error(err));