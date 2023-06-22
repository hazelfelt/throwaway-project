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
    canvas.width = canvas.clientWidth / pixel_scale;
    canvas.height = canvas.clientHeight / pixel_scale;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });



    // Modules.
    async function createModule(file, noun) {
        return device.createShaderModule({
            label: `${noun} shader`,
            code: await fetchText(file),
        });
    }

    let tileModule = await createModule('/tile.wgsl', 'tile');
    let spriteModule = await createModule('/sprite.wgsl', 'sprite');



    // Pipelines.
    const tilePipeline = device.createRenderPipeline({
        label: "tile rendering pipeline",
        layout: 'auto',
        primitive: {topology: "triangle-strip"},
        vertex: {
            module: tileModule,
            entryPoint: 'main_vertex',
            buffers: [{
                // vec2f ----
                // xxxx  xxxx
                arrayStride: 2*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x2',
                }],
            }],
        },
        fragment: {
            module: tileModule,
            entryPoint: 'main_fragment',
            targets: [{format: canvasFormat}],
        },
    });

    const spritePipeline = device.createRenderPipeline({
        label: "sprite rendering pipeline",
        layout: 'auto',
        primitive: {topology: "triangle-strip"},
        vertex: {
            module: spriteModule,
            entryPoint: 'main_vertex',
            buffers: [{
                // vec2f ----  u32-  padding
                // xxxx  xxxx  xxxx  xxxx
                stepMode: "instance",
                arrayStride: 4*4,
                attributes: [{
                    shaderLocation: 0,
                    offset: 0,
                    format: 'float32x2',
                }, {
                    shaderLocation: 1,
                    offset: 8,
                    format: 'uint32',
                }],
            }],
        },
        fragment: {
            module: spriteModule,
            entryPoint: 'main_fragment',
            targets: [{
                format: canvasFormat,

                // this blending *could* cause problems in the future, i haven't thought about it hard enough
                // specifically- colors might be wrong if the source color has semi-transparent pixels that
                // are not premultiplied (i.e. colors taken from atlas pngs'.)
                blend: {
                    color: {
                        operation: "add",
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                    },
                    alpha: {
                        operation: "add",
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                    }
                },
            }],
        },
    });



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



    // Tile and sprite atlases.
    async function createAtlas(id, noun, size) {
        const element = document.querySelector(`#${id}`);
        const source = await createImageBitmap(element, {colorSpaceConversion: "none"});
        const texture = device.createTexture({
            label: `${noun} atlas texture`,
            format: 'rgba8unorm',
            size: [source.width, source.height],
            usage: GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture(
            {source},
            {texture},
            {width: source.width, height: source.height},
        );

        const sizeBuffer = device.createBuffer({
            label: `${noun} atlas size uniform`,
            size: 2*4, // one vec2u
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        device.queue.writeBuffer(sizeBuffer, 0, new Uint32Array(size));

        return [texture, sizeBuffer];
    }

    const sampler = device.createSampler({magFilter: 'nearest'});
    let [tileAtlasTexture, tileAtlasSizeBuffer] = await createAtlas("tiles", "tile", [4, 4]);
    let [spriteAtlasTexture, spriteAtlasSizeBuffer] = await createAtlas("sprites", "sprite", [54, 19]);



    // Chunk pixel vertex buffer.
    const chunkPixelBuffer = device.createBuffer({
        label: "chunk pixel vertex buffer",
        size: 2*4*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(
        chunkPixelBuffer, 0,
        new Float32Array([
            0, 0,
            0, 128,
            128, 0,
            128, 128,
        ])
    );

    // Sprite location map storage buffer.
    const spriteLocationMapBuffer = device.createBuffer({
        label: "sprite location map storage buffer",
        size: 3*2*4,
        usage: GPUBufferUsage.STORAGE |  GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(spriteLocationMapBuffer, 0, new Uint32Array([
        0,  0,
        20, 0,
        38, 0,
    ]));

    // Sprite size map storage buffer.
    const spriteSizeMapBuffer = device.createBuffer({
        label: "sprite size map storage buffer",
        size: 3*2*4,
        usage: GPUBufferUsage.STORAGE |  GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(spriteSizeMapBuffer, 0, new Uint32Array([
        20, 12,
        18, 15,
        16, 19,
    ]));

    // Sprite corner buffer.
    const cornersBuffer = device.createBuffer({
        label: "corners storage buffer",
        size: 2*4*4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(cornersBuffer, 0, new Uint32Array([
        0, 0,
        0, 1,
        1, 0,
        1, 1,
    ]));



    // Bind groups.
    const tileBindGroup = device.createBindGroup({
        label: "tile bind group",
        layout: tilePipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: tileAtlasTexture.createView()},
            {binding: 1, resource: sampler},
            {binding: 2, resource: {buffer: tileAtlasSizeBuffer}},
            {binding: 3, resource: {buffer: resolutionBuffer}},
            {binding: 4, resource: {buffer: cameraBuffer}},
        ]
    });

    const spriteBindGroup = device.createBindGroup({
        label: "sprite bind group",
        layout: spritePipeline.getBindGroupLayout(0),
        entries: [
            {binding: 0, resource: spriteAtlasTexture.createView()},
            {binding: 1, resource: sampler},
            {binding: 2, resource: {buffer: spriteAtlasSizeBuffer}},
            {binding: 3, resource: {buffer: spriteLocationMapBuffer}},
            {binding: 4, resource: {buffer: spriteSizeMapBuffer}},
            {binding: 5, resource: {buffer: cornersBuffer}},

            {binding: 6, resource: {buffer: resolutionBuffer}},
            {binding: 7, resource: {buffer: cameraBuffer}},
        ]
    });



    // Chunks.
    let chunks = new Map();

    function getChunk(x, y) {
        let string = `${x}, ${y}`;
        if (!chunks.has(string)) chunks.set(string, createChunk(x, y));
        let chunk = chunks.get(string);
        return chunk;
    }

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
            layout: tilePipeline.getBindGroupLayout(1),
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

                let texture = 0;
                let d = Math.sqrt(cx*cx + cy*cy);
                if (d % 24 < 4) {
                    texture = 3;
                } else if (d % 24 < 6) {
                    texture = 4;
                } else {
                    let c = Math.round(cx*0.2 + cy*0.2);
                    texture = (c - 4*Math.floor(c/4)) + 12;
                }


                chunk.array.set([texture], y*16 + x);
            }
        }

        device.queue.writeBuffer(chunk.buffer, 0, chunk.array);
        device.queue.writeBuffer(chunk.posBuffer, 0, new Int32Array([x, y]));

        return chunk;
    }

    function setTile(x, y, texture) {
        let relX = x - 16*Math.floor(x/16);
        let relY = y - 16*Math.floor(y/16);
        let chunk = getChunk(Math.floor(x/16), Math.floor(y/16));

        chunk.array.set([texture], relY*16 + relX);
        device.queue.writeBuffer(chunk.buffer, 0, chunk.array);
    }



    // Sprites.
    let textureMap = new Map();
    textureMap.set('rectangle_rock', 0);
    textureMap.set('rock', 1);
    textureMap.set('tooth_rock', 2);

    let sprites = [
        {x: 0,  y: 0,  texture: 'rectangle_rock'},
        {x: 20, y: 10, texture: 'rock'          },
        {x: 40, y: 20, texture: 'tooth_rock'    },
        {x: 0,  y: 30, texture: 'rock'          },
        {x: 20, y: 40, texture: 'rectangle_rock'},
    ];

    // Sprites vertex buffer.
    const spriteCount = sprites.length;
    const spritesBuffer = device.createBuffer({
        label: "sprites vertex buffer",
        size: spriteCount*4*4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    let spritesByteArray = new ArrayBuffer(spriteCount*4*4);
    let spritesFloat32Array = new Float32Array(spritesByteArray);
    let spritesUint32Array = new Uint32Array(spritesByteArray);
    for (let i = 0; i < spriteCount; ++i) {
        let sprite = sprites[i];
        spritesFloat32Array.set([sprite.x,  sprite.y], i*4);
        spritesUint32Array.set([textureMap.get(sprite.texture)], i*4 + 2);
    }
    device.queue.writeBuffer(spritesBuffer, 0, spritesByteArray);



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
            if (keysDown.has("w")) this.focus_y += 4;
            if (keysDown.has("a")) this.focus_x -= 4;
            if (keysDown.has("s")) this.focus_y -= 4;
            if (keysDown.has("d")) this.focus_x += 4;

            this.x += (this.focus_x - this.x) * 0.175;
            this.y += (this.focus_y - this.y) * 0.175;

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
            let x = (camera.x + mousePos.x) / 8;
            let y = (camera.y + mousePos.y) / 8;

            [[+.5, +.5], [+.5, -.5], [-.5, +.5], [-.5, -.5]]
                .forEach(arr => setTile(
                    Math.floor(x + arr[0]),
                    Math.floor(y + arr[1]),
                    8
                ));

            let tileCoords = `${Math.floor(x)}, ${Math.floor(y)}`;
            document.querySelector('#mouse').innerText = `tile: (${tileCoords})`;
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

        // Tiles.
        pass.setPipeline(tilePipeline);
        pass.setVertexBuffer(0, chunkPixelBuffer);
        pass.setBindGroup(0, tileBindGroup);

        // Draw the nearest 9 chunks.
        let x = Math.floor(camera.x / 8 / 16);
        let y = Math.floor(camera.y / 8 / 16);
        for (let i = x-1; i <= x+1; ++i) {
            for (let j = y-1; j <= y+1; ++j) {
                pass.setBindGroup(1, getChunk(i, j).bindGroup);
                pass.draw(4);
            }
        }
        // pass.setBindGroup(1, null);

        // Sprites.
        pass.setPipeline(spritePipeline);
        pass.setVertexBuffer(0, spritesBuffer);
        pass.setBindGroup(0, spriteBindGroup);
        pass.draw(4, spriteCount);

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