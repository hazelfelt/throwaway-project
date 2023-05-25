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


    // Line shader.
    const lineWgsl = `
    @group(0) @binding(0) var<uniform> canvas: vec2f;

    @vertex fn main_vertex(@location(0) pos: vec2f) -> @builtin(position) vec4f {
        return vec4f(pos*2.0/canvas, 0.0, 1.0);
    }

    @fragment fn main_fragment() -> @location(0) vec4f {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    `;

    const lineModule = device.createShaderModule({
        label: "line shader",
        code: lineWgsl,
    });

    const linePipeline = device.createRenderPipeline({
        label: "line pipeline",
        layout: 'auto',
        primitive: {
            topology: "line-list",
        },
        vertex: {
            module: lineModule,
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
            module: lineModule,
            entryPoint: 'main_fragment',
            targets: [{ format: canvasFormat }],
        },
    });

    const canvasSizeBuffer = device.createBuffer({
        label: "canvas size buffer",
        size: 2*2*4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(canvasSizeBuffer, 0, new Float32Array([canvas.width, canvas.height]));

    const lineBindGroup = device.createBindGroup({
        label: "bind group",
        layout: linePipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: {buffer: canvasSizeBuffer}},
        ]
    });

    const lineBuffer = device.createBuffer({
        label: "vertex buffer",
        size: 2*2*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });



    // Multiply shader.
    const multiplyWgsl = `
    @vertex fn main_vertex(@location(0) position: vec2f) -> @builtin(position) vec4f {
        return vec4f(position, 0.0, 1.0);
    }

    @group(0) @binding(0) var<uniform> canvas: vec2f;
    @group(0) @binding(1) var frame: texture_2d<f32>;
    @group(0) @binding(2) var frame_sampler: sampler;

    @fragment fn main_fragment(@builtin(position) pos: vec4f) -> @location(0) vec4f {
        return textureSample(frame, frame_sampler, pos.xy/canvas) + vec4f(0.1, 0.5, 0.1, 0.0);
        // return vec4f(0.5, 0.5, 0.5, 1.0);
    }
    `;

    const multiplyModule = device.createShaderModule({
        label: "multiply shader",
        code: multiplyWgsl,
    });

    const multiplyPipeline = device.createRenderPipeline({
        layout: "auto",
        primitive: {
            topology: "triangle-strip",
        },
        vertex: {
            entryPoint: "main_vertex",
            module: multiplyModule,
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
            entryPoint: "main_fragment",
            module: multiplyModule,
            targets: [{ format: canvasFormat }],
        },
    });

    const frameTexture = device.createTexture({
        label: "frame texture",
        format: canvasFormat,
        size: [canvas.width, canvas.height],
        usage: GPUTextureUsage.TEXTURE_BINDING |
               GPUTextureUsage.COPY_DST |
               GPUTextureUsage.RENDER_ATTACHMENT
    });

    const sampler = device.createSampler({
        label: "sampler",
    });

    const multiplyBindGroup = device.createBindGroup({
        label: "multiply bind group",
        layout: multiplyPipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: {buffer: canvasSizeBuffer}},
            {binding: 1, resource: frameTexture.createView()},
            {binding: 2, resource: sampler},
        ]
    })

    const canvasCornersBuffer = device.createBuffer({
        label: "canvas corners vertex buffer",
        size: 2*4*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(canvasCornersBuffer, 0, new Float32Array([
        -1, 1,
        -1, -1,
        1, 1,
        1, -1,
    ]));



    // Rendering.
    const renderPassDesc = {
        label: 'render pass',
        colorAttachments: [{
            view: null, // to be set during rendering
            clearValue: [1.0, 1.0, 1.0, 1.0],
            loadOp: 'clear',
            storeOp: 'store',
        }],
    };

    function render() {
        const encoder = device.createCommandEncoder({ label: 'encoder' });

        // Line shader pass.
        renderPassDesc.colorAttachments[0].view = frameTexture.createView();
        const linePass = encoder.beginRenderPass(renderPassDesc);

        linePass.setPipeline(linePipeline);
        linePass.setVertexBuffer(0, lineBuffer);
        linePass.setBindGroup(0, lineBindGroup);
        linePass.draw(2);
        linePass.end();

        // Multiply shader pass.
        renderPassDesc.colorAttachments[0].view = context.getCurrentTexture().createView();
        const multiplyPass = encoder.beginRenderPass(renderPassDesc);

        multiplyPass.setPipeline(multiplyPipeline);
        multiplyPass.setVertexBuffer(0, canvasCornersBuffer);
        multiplyPass.setBindGroup(0, multiplyBindGroup);
        multiplyPass.draw(4);
        multiplyPass.end();

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
        device.queue.writeBuffer(lineBuffer, 0, new Float32Array(cornerA.concat(cornerB)));
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