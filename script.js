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
    const pixel_scale = 4;
    canvas.width  = canvas.clientWidth / pixel_scale;
    canvas.height = canvas.clientHeight / pixel_scale;

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
        primitive: { topology: "triangle-strip" },
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



    // ...Buffers.
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
    device.queue.writeBuffer(atlasSizeBuffer, 0, new Uint32Array([4, 4]));

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
    device.queue.writeBuffer(cameraBuffer, 0, new Float32Array([0, 0]));



    // Chunks.
    let chunks = new Map();

    function getChunk(x, y) {
        let string = `${x}, ${y}`;
        if (!chunks.has(string)) chunks.set(string, createChunk(x, y));
        let chunk = chunks.get(string);
        return chunk;
    };

    function createChunk(x, y) {
        let posBuffer = device.createBuffer({
            label: `chunk (${x}, ${y}) position uniform buffer`,
            size: 2*4, // one vec2f
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        let buffer = device.createBuffer({
            label: `chunk (${x}, ${y}) storage buffer`,
            size: 16*16*4, // 16x16 grid of u32s
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        let bindGroup = device.createBindGroup({
            label: `chunk (${x}, ${y}) bind group`,
            layout: pipeline.getBindGroupLayout(1),
            entries: [
                {binding: 0, resource: {buffer: buffer}},
                {binding: 1, resource: {buffer: posBuffer}},
            ],
        });

        let chunk = {
            x, y,
            posBuffer,
            array: new Uint32Array(16*16),
            buffer,
            bindGroup,
        };

        // Determine tile textures.
        for (let y = 0; y < 16; ++y) {
            for (let x = 0; x < 16; ++x) {

                // World-relative coordinates, centered at 0.5, 0.5 on the tile.
                let cx = x + 0.5 + chunk.x*16;
                let cy = y + 0.5 + chunk.y*16;
                let texture = Math.sqrt(cx*cx+cy*cy) % 4 + 12; // circle-y worldgen

                chunk.array.set([texture], y*16 + x);
            }
        }

        device.queue.writeBuffer(chunk.buffer, 0, chunk.array);
        device.queue.writeBuffer(chunk.posBuffer, 0, new Int32Array([x, y]));

        return chunk;
    };

    function setTile(x, y) {
        let relX = x - 16*Math.floor(x / 16);
        let relY = y - 16*Math.floor(y / 16);
        let chunk = getChunk(Math.floor(x/16), Math.floor(y/16));

        chunk.array.set([8], relY*16 + relX);
        device.queue.writeBuffer(chunk.buffer, 0, chunk.array);
    }



    // Bind group.
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



    // Controls
    let keysDown = new Set();
    let mouseDown = false;
    let mousePos = null;

    window.addEventListener("keydown", function(e) { keysDown.add(e.key); });
    window.addEventListener("keyup", function(e) { keysDown.delete(e.key); });
    window.addEventListener("blur", function() {
        keysDown.clear();
        mousePos = null;
        mouseDown = false;
    });

    let frame = 0;
    let camera = {
        x: 0,
        y: 0,
        focus_x: 0,
        focus_y: 0,
        array: new Float32Array([this.x, this.y]),

        update() {
            if (keysDown.has("w")) this.focus_y += 6;
            if (keysDown.has("a")) this.focus_x -= 6;
            if (keysDown.has("s")) this.focus_y -= 6;
            if (keysDown.has("d")) this.focus_x += 6;

            this.x += (this.focus_x - this.x) * 0.1;
            this.y += (this.focus_y - this.y) * 0.1;

            this.array.set([this.x, this.y], 0);
            device.queue.writeBuffer(cameraBuffer, 0, this.array);
        }
    }

    canvas.addEventListener("mousemove", function(e) {
        mousePos = {
            x: -canvas.width/2  + e.offsetX/pixel_scale,
            y:  canvas.height/2 - e.offsetY/pixel_scale,
        };
    });
    canvas.addEventListener("mouseleave", function() { mouseDown = false; });
    canvas.addEventListener("mouseup",    function() { mouseDown = false; });
    canvas.addEventListener("mouseenter", function(e) { mouseDown = e.buttons & 1; });
    canvas.addEventListener("mousedown",  function(e) {
        mouseDown = e.buttons & 1;
        mousePos = { // handles an edge case where the cursor is already over the canvas on page load, then user clicks
            x: -canvas.width/2  + e.offsetX/pixel_scale,
            y:  canvas.height/2 - e.offsetY/pixel_scale,
        };
    });



    // Updating.
    function update() {
        camera.update();
        document.querySelector('#stats').innerText = `${frame} / (${camera.focus_x}, ${camera.focus_y})`;

        // Clicked tile
        if (mouseDown) {
            let x = Math.floor((camera.x + mousePos.x) / 8);
            let y = Math.floor((camera.y + mousePos.y) / 8);
            setTile(x, y);
            document.querySelector('#mouse').innerText = `tile: (${x}, ${y})`; // tile coords
        } else {
            document.querySelector('#mouse').innerText = `tile: ...`;
        }

        ++frame;
    }



    // Rendering.
    function render() {

        const encoder = device.createCommandEncoder({ label: 'encoder' });
        const pass = encoder.beginRenderPass({
            label: 'render pass',
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: [0.02, 0.05, 0.1, 1.0],
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.setBindGroup(0, bindGroup);

        // Draw the 9 nearest chunks.
        let x = Math.floor(camera.x / 8 / 16);
        let y = Math.floor(camera.y / 8 / 16);
        for (let i = x-1; i <= x+1; ++i) {
            for (let j = y-1; j <= y+1; ++j) {
                pass.setBindGroup(1, getChunk(i, j).bindGroup);
                pass.draw(4);
            }
        }

        pass.end();
        device.queue.submit([encoder.finish()]);
    }



    // Loop.
    function loop() {
        update();
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}



window.addEventListener("contextmenu", function(e) { e.preventDefault(); });

main().catch(err => console.error(err));