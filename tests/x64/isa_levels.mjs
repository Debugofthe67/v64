#!/usr/bin/env node
// Run the same bytes before long mode, in 64-bit mode, and in compatibility
// mode. The handler records #UD and resumes at the following instruction.
import assert from "node:assert/strict";
import {assemble, actual} from "./guest_runner.mjs";
import {long_mode_guest} from "./guest_builder.mjs";

const cases = [];
function probes(mode)
{
    const instructions = [
        [1, "cmpxchg8b [scratch]"], [1, "addpd xmm0,xmm1"],
        [mode === 64 ? 2 : 1, "lahf"], [mode === 64 ? 2 : 1, "sahf"],
        [2, "popcnt eax,ebx"],
        ...["movddup xmm0,xmm1", "movsldup xmm0,xmm1", "movshdup xmm0,xmm1",
            "haddps xmm0,xmm1", "haddpd xmm0,xmm1", "hsubps xmm0,xmm1",
            "hsubpd xmm0,xmm1", "addsubps xmm0,xmm1", "addsubpd xmm0,xmm1",
            "lddqu xmm0,[scratch]"].map(op => [2, op]),
        [2, "fisttp word [scratch]"], [2, "fisttp dword [scratch]"], [2, "fisttp qword [scratch]"],
        [1, "fcmovne st0,st1"], // DB /1 register form shares a row with FISTTP
        [2, "pshufb xmm0,xmm1"], [2, "pminud xmm0,xmm1"], [2, "crc32 eax,bl"],
        [3, "vzeroupper"], [3, "vpaddd ymm0,ymm0,ymm1"], [3, "vcvtph2ps xmm0,xmm1"],
        [3, "vfmadd132ps xmm0,xmm1,xmm2"], [3, "andn eax,ebx,ecx"], [3, "pext eax,ebx,ecx"],
        [3, "movbe eax,[scratch]"],
    ];
    if(mode === 64) instructions.push([2, "cmpxchg16b [scratch]"]);
    return instructions.map(([level, op]) => {
        const i = cases.length;
        cases.push({mode, level, op});
        return `fninit
fld1
fld1
mov esi,${0x300004 + i}
mov byte [esi],0
mov edi,end${i} - op${i}
op${i}: ${op}
end${i}:`;
    }).join("\n");
}

const protected_probes = probes(32), long_probes = probes(64), compat_probes = probes("compat");
const lzcnt_result = 0x300004 + cases.length;
const protected_body = `
mov eax,ud32
mov [idt32 + 6 * 8],ax
shr eax,16
mov [idt32 + 6 * 8 + 6],ax
lidt [idtr32]
mov eax,cr4
or eax,3 << 9
mov cr4,eax
mov eax,1
cpuid
bt ecx,26
jnc .ready
mov eax,cr4
or eax,1 << 18
mov cr4,eax
xor ecx,ecx
xor edx,edx
mov eax,7
xsetbv
.ready:
mov ebp,200
protected_round:
${protected_probes}
dec ebp
jnz protected_round
`;

const directory = assemble("isa-levels", long_mode_guest(`
mov eax,ud64
mov [idt64 + 6 * 16],ax
shr eax,16
mov [idt64 + 6 * 16 + 6],ax
lidt [rel idtr64]
mov ebp,200
long_round:
${long_probes}
dec ebp
jnz long_round
push 8
push compat
o64 retf
bits 32
compat:
mov ebp,200
compat_round:
${compat_probes}
dec ebp
jnz compat_round
jmp 0x18:back
bits 64
back:
mov eax,1
lzcnt eax,eax
mov [${lzcnt_result}],al
`, `
ud64:
mov byte [rsi],1
add [rsp],rdi
iretq
bits 32
ud32:
mov byte [esi],1
add [esp],edi
iretd
align 16
scratch: times 32 db 0
idt32: times 6 dq 0
dw 0,8,0x8E00,0
idtr32: dw 7 * 8 - 1
dd idt32
idt64: times 12 dq 0
dw 0,24,0x8E00,0
dq 0
idtr64: dw 7 * 16 - 1
dq idt64
bits 64
`, protected_body));

for(const [features, level] of [["x86-64-v1", 1], ["x86-64-v2", 2], ["x86-64-v3", 3], [[], 1]])
{
    for(const jit of [false, true])
    {
        const bytes = await actual(directory, {length: 5 + cases.length, options: {cpu_type: "x86_64",
            cpu_features: features, disable_jit: !jit, experimental_smp_jit: jit, ir_sync_publication: true}});
        for(const [i, test] of cases.entries())
        {
            const historical = Array.isArray(features) && test.level === 2 && !/^(pshufb|pminud|crc32)/.test(test.op);
            assert.equal(bytes[4 + i], +(test.level > level && !historical),
                `${JSON.stringify(features)}, JIT=${jit}, ${test.mode}: ${test.op}`);
        }
        assert.equal(bytes.at(-1), level === 3 ? 31 : 0, "LZCNT or its BSR fallback");
        console.log(`PASS ${JSON.stringify(features)}, JIT=${jit}: ${cases.length} instruction checks`);
    }
}
