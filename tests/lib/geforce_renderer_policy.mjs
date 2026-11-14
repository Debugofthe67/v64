import assert from "node:assert/strict";

// Host-side comparison only. The native driver and guest state are unchanged;
// withholding the optional host feature selects the existing CPU conversion.
export function geforce_renderer_policy(renderer, policy="auto")
{
    assert(["auto","cpu"].includes(policy),"NV_HOST_BC must be auto or cpu");
    if(policy==="auto")return renderer;
    assert(renderer && typeof renderer.listen==="function","NV_HOST_BC=cpu comparison requires a real renderer");
    const listen=renderer.listen.bind(renderer);
    renderer.listen=handler=>listen(message=>handler(message.type==="caps"?
        {...message,textureCompressionBC:false}:message));
    return renderer;
}
