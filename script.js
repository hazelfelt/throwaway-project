// TODO: there's some really weird texture bleeding(??) going on??
// *specifically* when i nudge the chunk down by like. 1.6 pixels.
// Then there's an extra row of garbage pixels at the very top
//
// im not sure why it's happening but im way too tired tonight to bother figuring it out lol
//
// it's definitely due to some floating point magic, though.
// maybe due to the fact that, there's a Lotta mingling of u32's AND f32's in the fragment shader?
// maybe it's because [one of the coordinate systems im using] is centered on 0.0, 0.0, instead of 0.5, 0.5(??)
//
// i dont know. that's just me throwing stuff at the wall. it's for future me to figure out.

// ALSO TODO:
// make sure both chunks get rendered, rn they're perfectly superimposed on top of each other lol

async function fetchText(url) {
    const response = await fetch(url);
    const text = await response.text();
    return text;
}

async function main() {

    // Adapter, device.
    const adapter = await navigator.gpu?.requestAdapter();
    const device = await adapter?.requestDevice();
    if (!device) throw new Error('need a browser that supports WebGPU');



    // Canvas and WebGPU context.
    const canvas = document.querySelector('canvas');
    const zoom = 4;
    canvas.width  = canvas.clientWidth / zoom;
    canvas.height = canvas.clientHeight / zoom;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });



    // Chunk rendering shader.
    const wgsl = await fetchText('/shader.wgsl');

    const module = device.createShaderModule({
        label: "chunk shader",
        code: wgsl,
    });



    // Pipeline.
    const pipeline = device.createRenderPipeline({
        label: "chunk rendering pipeline",
        layout: 'auto',
        primitive: {
            topology: "triangle-strip"
        },
        vertex: {
            module,
            entryPoint: 'main_vertex',
            buffers: [{
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x2'
                }]
            }],
        },
        fragment: {
            module,
            entryPoint: 'main_fragment',
            targets: [{ format: canvasFormat }],
        },
    });



    // Vertex buffer.
    const vertexBuffer = device.createBuffer({
        label: "vertex buffer",
        size: 2*4*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        vertexBuffer, 0,
        new Float32Array([
            0, 0,
            0, 128,
            128, 0,
            128, 128,
        ])
    );



    // Atlas .png file and sampler.
    const atlasElement = document.querySelector("img");
    const source = await createImageBitmap(atlasElement, { colorSpaceConversion: "none" });
    const texture = device.createTexture({
        label: "atlas texture",
        format: 'rgba8unorm',
        size: [source.width, source.height],
        usage: GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
        { source, flipY: false },
        { texture },
        { width: source.width, height: source.height },
    );

    const sampler = device.createSampler({
        magFilter: 'nearest',
    });

    // Atlas size buffer.
    const atlasSizeBuffer = device.createBuffer({
        label: "atlas size uniform",
        size: 2*4, // one vec2u
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(
        atlasSizeBuffer,
        0,
        new Uint32Array([4, 1])
    );

    // Resolution buffer.
    const resolutionBuffer = device.createBuffer({
        label: "canvas resolution uniform",
        size: 2*4, // one vec2f
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        resolutionBuffer, 0,
        new Float32Array([canvas.width, canvas.height])
    );

    // Camera buffer.
    const cameraBuffer = device.createBuffer({
        label: "camera uniform",
        size: 2*4, // one vec2f
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(cameraBuffer, 0, new Float32Array([64, 64]));

    // Chunk buffer.
    const chunkBuffer = device.createBuffer({
        label: "chunk storage buffer",
        size: 16*16*4, // 16x16 grid of u32s
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const chunkArray = new Uint32Array(16*16);
    for (let y = 0; y < 16; ++y) {
        for (let x = 0; x < 16; ++x) {
            let offset = y*16 + x;
            let texture = Math.sqrt(x*x+y*y) % 4;
            chunkArray.set([texture], offset);
        }
    }
    device.queue.writeBuffer(chunkBuffer, 0, chunkArray);

    // Another chunk buffer.
    const anotherChunkBuffer = device.createBuffer({
        label: "another chunk storage buffer",
        size: 16*16*4, // 16x16 grid of u32s
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const anotherChunkArray = new Uint32Array(16*16);
    for (let y = 0; y < 16; ++y) {
        for (let x = 0; x < 16; ++x) {
            let offset = y*16 + x;
            let texture = Math.sqrt((x-32)*(x-32)+(y-16)*(y-16)) % 4;
            anotherChunkArray.set([texture], offset);
        }
    }
    device.queue.writeBuffer(anotherChunkBuffer, 0, anotherChunkArray);

    // Bind groups.
    const bindGroup = device.createBindGroup({
        label: "bind group",
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: texture.createView()},
            {binding: 1, resource: sampler},
            {binding: 2, resource: {buffer: atlasSizeBuffer}},
            {binding: 3, resource: {buffer: resolutionBuffer}},
            {binding: 4, resource: {buffer: cameraBuffer}},
        ]
    });

    const chunkBindGroup = device.createBindGroup({
        label: "chunk bind group",
        layout: pipeline.getBindGroupLayout(1),
        entries: [{binding: 0, resource: {buffer: chunkBuffer}}],
    });

    const anotherChunkBindGroup = device.createBindGroup({
        label: "another chunk bind group",
        layout: pipeline.getBindGroupLayout(1),
        entries: [{binding: 0, resource: {buffer: anotherChunkBuffer}}],
    });


    function render() {

        // Command encoder, render pass.
        const encoder = device.createCommandEncoder({ label: 'encoder' });
        const pass = encoder.beginRenderPass({
            label: 'render pass',
            colorAttachments: [
                { // We're rendering to the canvas's current texture.
                    view: context.getCurrentTexture().createView(),
                    clearValue: [0.02, 0.05, 0.1, 1.0],
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        });

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setBindGroup(0, bindGroup);

        pass.setBindGroup(1, chunkBindGroup);
        pass.draw(4);

        pass.setBindGroup(1, anotherChunkBindGroup);
        pass.draw(4);

        pass.end();

        // We're done. Form a command buffer from `encoder`, and submit it.
        device.queue.submit([encoder.finish()]);
    }



    // Stateful things.
    let x = 64;
    let y = 0;
    let frame = 0;

    function update() {
        y = 64 + 8 * Math.sin(frame / 120);
        x = 64 + 8 * Math.cos(frame / 120);
        device.queue.writeBuffer(cameraBuffer, 0, new Float32Array([x, y]));
        ++frame;
    }

    // Loop.
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