#!/usr/bin/env python3
"""Pinned public Korean seq2seq CPU export/quantization/latency experiment.

Run with .local/realizer-venv/bin/python runtime/realizer/benchmark-onnx.py.
No training. All caches/weights remain inside this repository's .local tree.
Reported generation is a runtime smoke test, not trained realizer quality.
"""
from __future__ import annotations

import argparse
import collections
import gc
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.local' / 'realizer-cache'
MODELS = ROOT / '.local' / 'realizer-models'
for key, value in {
    'HF_HOME': str(CACHE / 'huggingface'),
    'HF_HUB_CACHE': str(CACHE / 'huggingface' / 'hub'),
    'PIP_CACHE_DIR': str(CACHE / 'pip'),
    'XDG_CACHE_HOME': str(CACHE / 'xdg'),
    'TORCH_HOME': str(CACHE / 'torch'),
    'TMPDIR': str(CACHE / 'tmp'),
    'HF_HUB_DISABLE_IMPLICIT_TOKEN': '1',
    'HF_HUB_DISABLE_TELEMETRY': '1',
    'HF_HUB_DISABLE_XET': '1',
    'DO_NOT_TRACK': '1',
    'TOKENIZERS_PARALLELISM': 'false',
    'OMP_NUM_THREADS': '1',
    'MKL_NUM_THREADS': '1',
    'OPENBLAS_NUM_THREADS': '1',
    'NUMEXPR_NUM_THREADS': '1',
    'CUDA_VISIBLE_DEVICES': '',
}.items():
    os.environ[key] = value
for name in ('tmp', 'xdg', 'torch'):
    (CACHE / name).mkdir(parents=True, exist_ok=True)
MODELS.mkdir(parents=True, exist_ok=True)

import numpy as np
import onnx
from onnx import numpy_helper
import onnxruntime as ort
from onnxruntime.quantization import QuantType, quantize_dynamic
import torch
from huggingface_hub import HfApi, snapshot_download
from optimum.exporters.onnx import main_export
from optimum.onnxruntime import ORTModelForSeq2SeqLM
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, PreTrainedTokenizerFast
from tokenizers.processors import TemplateProcessing

torch.set_num_threads(1)
torch.set_num_interop_threads(1)

SPECS = {
    'ke-t5-small': {
        'id': 'KETI-NLP/ke-t5-small',
        'revision': 'c99e8447b82d036fbfb75dcec33fb60fdf94e189',
        'license_note': 'Hub metadata Apache-2.0; dataset rights not adjudicated.',
    },
    'bart-ko-small': {
        'id': 'cosmoquester/bart-ko-small',
        'revision': '32c6ec5844197a774d6460e7fc83812af9dc24e3',
        'license_note': 'Weight license unresolved: internal runtime comparison only; no deployment endorsement.',
    },
}
TEXT = '말투: 해요체\n주체: 민지\n행동: 주문 확인\n상품: 커피\n수량: 2잔\n시간: 오늘 오후 3시\n문장:'
GRAPH_NAMES = ['encoder_model.onnx', 'decoder_model.onnx', 'decoder_with_past_model.onnx']


def emit(stage, **extra):
    print(json.dumps({'time': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                      'stage': stage, **extra}, ensure_ascii=False), flush=True)


def write_json(path, value):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    tmp.replace(path)


def sha_file(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def file_info(path):
    return {'name': path.name, 'bytes': path.stat().st_size, 'sha256': sha_file(path)}


def attach_deployment_metadata(result, base):
    result['deployment_metadata'] = {}
    for dtype in ('fp32', 'int8'):
        files = [file_info(p) for p in sorted((base / dtype).iterdir())
                 if p.is_file() and p.suffix in {'.json', '.model', '.txt'}]
        total = sum(p['bytes'] for p in files)
        result['deployment_metadata'][dtype] = {
            'files': files, 'total_bytes': total,
            'graphs_plus_metadata_bytes': result['artifacts'][dtype]['total_graph_bytes'] + total}
    result['tokenizer_and_config_files_note'] = (
        'Legacy field lists prepared source files. deployment_metadata lists the actual exported bundle files.')


def inventory(folder, vocab, hidden):
    files, all_hashes = [], collections.defaultdict(list)
    for name in GRAPH_NAMES:
        path = folder / name
        graph = onnx.load(str(path))
        by_dtype = collections.defaultdict(lambda: {'tensors': 0, 'elements': 0, 'raw_bytes': 0})
        matrices = []
        ops = collections.Counter(n.op_type for n in graph.graph.node)
        for tensor in graph.graph.initializer:
            arr = numpy_helper.to_array(tensor)
            dtype = onnx.TensorProto.DataType.Name(tensor.data_type)
            row = by_dtype[dtype]
            row['tensors'] += 1
            row['elements'] += int(arr.size)
            row['raw_bytes'] += int(arr.nbytes)
            digest = hashlib.sha256(arr.tobytes()).hexdigest()
            all_hashes[(dtype, tuple(arr.shape), digest)].append({'file': name, 'name': tensor.name, 'bytes': int(arr.nbytes)})
            if tuple(arr.shape) in {(vocab, hidden), (hidden, vocab)}:
                canonical = arr.T if arr.shape == (hidden, vocab) else arr
                matrices.append({'name': tensor.name, 'dtype': dtype,
                                 'shape': list(arr.shape), 'elements': int(arr.size),
                                 'raw_bytes': int(arr.nbytes),
                                 'vocab_by_hidden_sha256': hashlib.sha256(canonical.tobytes()).hexdigest()})
        files.append({**file_info(path), 'initializers': dict(by_dtype),
                      'operators': dict(ops), 'embedding_or_lm_head_sized_tensors': matrices})
        del graph
    duplicates = []
    for (dtype, shape, digest), occurrences in all_hashes.items():
        if len({x['file'] for x in occurrences}) > 1 and math.prod(shape) >= 100000:
            duplicates.append({'dtype': dtype, 'shape': list(shape), 'sha256': digest,
                               'occurrences': occurrences})
    return {'graph_files': files, 'total_graph_bytes': sum(f['bytes'] for f in files),
            'large_identical_initializers_across_graphs': duplicates,
            'count_note': 'Initializer element counts include graph constants and repeated stored weights, not unique trainable parameter counts.'}


def distribution(values):
    return {'count': len(values), 'p50_ms': float(np.percentile(values, 50)),
            'p95_ms': float(np.percentile(values, 95)), 'mean_ms': statistics.mean(values),
            'min_ms': min(values), 'max_ms': max(values), 'samples_ms': values}


def load_tokenizer(key, path):
    if key != 'bart-ko-small':
        return AutoTokenizer.from_pretrained(path, local_files_only=True)
    # The author's tokenizer is Unigram/Metaspace, not BART byte-level BPE.
    # Their model card requires explicit [BOS] sentence [EOS] wrapping.
    spec = SPECS[key]
    tokenizer = PreTrainedTokenizerFast.from_pretrained(
        spec['id'], revision=spec['revision'], token=False,
        cache_dir=str(CACHE / 'huggingface' / 'hub'), local_files_only=True,
    )
    assert len(tokenizer) == 32000
    assert (tokenizer.bos_token_id, tokenizer.eos_token_id, tokenizer.pad_token_id) == (2, 3, 0)
    tokenizer.backend_tokenizer.post_processor = TemplateProcessing(
        single='[BOS] $A [EOS]', special_tokens=[('[BOS]', 2), ('[EOS]', 3)])
    raw = tokenizer(TEXT, add_special_tokens=False)['input_ids']
    wrapped = tokenizer(TEXT)['input_ids']
    assert wrapped == [2, *raw, 3]
    assert max(wrapped) < 32000
    return tokenizer


def hardware():
    cpuinfo = Path('/proc/cpuinfo').read_text()
    first = cpuinfo.split('\n\n')[0]
    fields = dict(line.split(':', 1) for line in first.splitlines() if ':' in line)
    fields = {k.strip(): v.strip() for k, v in fields.items()}
    flags = fields.get('flags', '').split()
    return {'hostname': platform.node(), 'platform': platform.platform(),
            'python': sys.version, 'processor': fields.get('model name'),
            'logical_cpus': os.cpu_count(), 'affinity_cpus': sorted(os.sched_getaffinity(0)),
            'avx': 'avx' in flags, 'avx2': 'avx2' in flags, 'avx512_vnni': 'avx512_vnni' in flags,
            'meminfo_first_lines': Path('/proc/meminfo').read_text().splitlines()[:3],
            'packages': {n: importlib.metadata.version(n) for n in ['torch', 'transformers', 'optimum', 'optimum-onnx', 'onnx', 'onnxruntime', 'sentencepiece', 'numpy', 'huggingface-hub', 'tokenizers']},
            'environment': {k: os.environ[k] for k in ['HF_HOME', 'HF_HUB_CACHE', 'PIP_CACHE_DIR', 'XDG_CACHE_HOME', 'OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'HF_HUB_DISABLE_IMPLICIT_TOKEN', 'CUDA_VISIBLE_DEVICES']}}


def fixed_generate(model, tokenizer, length):
    t0 = time.perf_counter()
    inp = tokenizer(TEXT, return_tensors='pt')
    inp.pop('token_type_ids', None)
    t1 = time.perf_counter()
    with torch.inference_mode():
        out = model.generate(**inp, do_sample=False, num_beams=1,
                             use_cache=True, min_new_tokens=length, max_new_tokens=length)
    t2 = time.perf_counter()
    decoded = tokenizer.batch_decode(out, skip_special_tokens=False)[0]
    t3 = time.perf_counter()
    # encoder-decoder generate includes one decoder start token.
    generated = out[0, 1:].tolist()
    assert len(generated) == length, (len(generated), length)
    return {'model_ms': (t2 - t1) * 1000, 'e2e_ms': (t3 - t0) * 1000,
            'tokenize_ms': (t1 - t0) * 1000, 'decode_ms': (t3 - t2) * 1000,
            'input_tokens': int(inp['input_ids'].shape[1]), 'generated_token_count': len(generated),
            'output_ids': out[0].tolist(), 'decoded_with_special_tokens': decoded}


def measure(folder, tokenizer, threads, warmups, repeats):
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    so.log_severity_level = 3
    t0 = time.perf_counter()
    model = ORTModelForSeq2SeqLM.from_pretrained(
        str(folder), provider='CPUExecutionProvider', session_options=so,
        use_cache=True, use_merged=False, local_files_only=True,
    )
    load_ms = (time.perf_counter() - t0) * 1000
    first = fixed_generate(model, tokenizer, 16)
    result = {'threads': threads, 'session_load_ms': load_ms,
              'session_load_note': 'New ORT sessions, existing local files; OS filesystem cache not flushed; not network cold-start.',
              'first_inference': first, 'fixed_length': []}
    for length in (16, 32):
        for _ in range(warmups):
            fixed_generate(model, tokenizer, length)
        samples = [fixed_generate(model, tokenizer, length) for _ in range(repeats)]
        result['fixed_length'].append({
            'length': length, 'warmups': warmups, 'repeats': repeats,
            'model_latency': distribution([x['model_ms'] for x in samples]),
            'e2e_latency': distribution([x['e2e_ms'] for x in samples]),
            'tokenize_latency': distribution([x['tokenize_ms'] for x in samples]),
            'decode_latency': distribution([x['decode_ms'] for x in samples]),
            'input_tokens': samples[0]['input_tokens'],
            'generated_token_count': samples[0]['generated_token_count'],
            'output_ids': samples[0]['output_ids'],
            'decoded_with_special_tokens': samples[0]['decoded_with_special_tokens'],
            'deterministic_ids_across_repeats': all(s['output_ids'] == samples[0]['output_ids'] for s in samples),
        })
        emit('measured', folder=folder.name, threads=threads, length=length,
             p50_ms=result['fixed_length'][-1]['model_latency']['p50_ms'])
    inp = tokenizer(TEXT, return_tensors='pt')
    inp.pop('token_type_ids', None)
    with torch.inference_mode():
        natural = model.generate(**inp, do_sample=False, num_beams=1, use_cache=True,
                                 min_new_tokens=0, max_new_tokens=32)
    result['natural_eos_smoke'] = {
        'output_ids': natural[0].tolist(), 'generated_token_count': int(natural.shape[1] - 1),
        'text': tokenizer.batch_decode(natural, skip_special_tokens=False)[0],
        'quality_claim': 'None. Pretrained checkpoint has not been trained as a realizer.'}
    del model
    gc.collect()
    return result


def run_one(key, warmups, repeats):
    spec = SPECS[key]
    base = MODELS / key
    base.mkdir(exist_ok=True)
    phase_file = base / 'preparation.json'
    completed_file = base / 'result.json'
    if completed_file.exists():
        completed = json.loads(completed_file.read_text())
        if ('fp32_pytorch_reference_fixed16_exact_ids' in completed
                and all(cell['warmups'] == warmups and cell['repeats'] == repeats
                        for run in completed.get('runs', []) for cell in run['fixed_length'])
                and (key != 'bart-ko-small' or completed.get('tokenizer_processing') == 'unigram_metaspace_bos_eos_template_v1')):
            attach_deployment_metadata(completed, base)
            write_json(completed_file, completed)
            emit('reuse_completed', model=key)
            return completed
    if phase_file.exists():
        result = json.loads(phase_file.read_text())
        emit('resume_preparation', model=key)
    else:
        result = dict(spec)
        emit('download_start', model=key, revision=spec['revision'])
        t0 = time.perf_counter()
        info = HfApi(token=False).model_info(spec['id'], revision=spec['revision'])
        available = {f.rfilename for f in info.siblings}
        weight = 'model.safetensors' if 'model.safetensors' in available else 'pytorch_model.bin'
        snapshot = snapshot_download(
            spec['id'], revision=spec['revision'], token=False,
            cache_dir=str(CACHE / 'huggingface' / 'hub'), max_workers=2,
            allow_patterns=[weight, '*.json', '*.model', 'vocab.txt', 'merges.txt'],
        )
        result['download_seconds'] = time.perf_counter() - t0
        result['source_files'] = [file_info(p) for p in sorted(Path(snapshot).iterdir()) if p.is_file()]
        t0 = time.perf_counter()
        tokenizer = load_tokenizer(key, snapshot)
        result['tokenizer_load_ms'] = (time.perf_counter() - t0) * 1000
        t0 = time.perf_counter()
        model = AutoModelForSeq2SeqLM.from_pretrained(snapshot, local_files_only=True,
                                                    attn_implementation='eager')
        model.eval()
        result['pytorch_load_ms'] = (time.perf_counter() - t0) * 1000
        result['config_original'] = model.config.to_dict()
        result['unique_parameter_numel'] = sum(p.numel() for p in model.parameters())
        aliases = collections.defaultdict(list)
        for name, parameter in model.named_parameters(remove_duplicate=False):
            aliases[parameter.data_ptr()].append(name)
        result['tied_parameter_names'] = [names for names in aliases.values() if len(names) > 1]
        model.config.use_cache = True
        model.generation_config.use_cache = True
        result['inference_config_change'] = {'use_cache': True, 'attention_implementation': 'eager', 'weights_changed': False}
        source = base / 'source'
        model.save_pretrained(source, safe_serialization=True)
        tokenizer.save_pretrained(source)
        result['generation_config'] = model.generation_config.to_dict()
        result['pytorch_reference_fixed16'] = fixed_generate(model, tokenizer, 16)
        del model
        gc.collect()
        emit('download_and_pytorch_ready', model=key, parameters=result['unique_parameter_numel'])
        write_json(phase_file, result)

    source = base / 'source'
    tokenizer = load_tokenizer(key, source)
    if key == 'bart-ko-small':
        tokenizer.save_pretrained(source)
        reloaded = PreTrainedTokenizerFast.from_pretrained(source, local_files_only=True)
        assert reloaded(TEXT)['input_ids'] == tokenizer(TEXT)['input_ids']
        if result.get('tokenizer_processing') != 'unigram_metaspace_bos_eos_template_v1':
            ref_model = AutoModelForSeq2SeqLM.from_pretrained(source, local_files_only=True,
                                                           attn_implementation='eager').eval()
            result['pytorch_reference_fixed16'] = fixed_generate(ref_model, tokenizer, 16)
            del ref_model
            gc.collect()
        result['tokenizer_processing'] = 'unigram_metaspace_bos_eos_template_v1'
        result['tokenizer_validation'] = {'length': len(tokenizer), 'bos': tokenizer.bos_token_id,
                                          'eos': tokenizer.eos_token_id, 'pad': tokenizer.pad_token_id,
                                          'save_reload_equal_ids': True, 'input_ids': tokenizer(TEXT)['input_ids']}
        write_json(phase_file, result)
    fp32, int8 = base / 'fp32', base / 'int8'
    if not all((fp32 / name).exists() for name in GRAPH_NAMES):
        emit('export_start', model=key)
        t0 = time.perf_counter()
        # Validation below uses explicitly capped ORT sessions. Optimum's implicit
        # validation session would otherwise choose all host CPU cores.
        main_export(str(source), output=fp32, task='text2text-generation-with-past',
                    opset=17, device='cpu', no_post_process=True,
                    local_files_only=True, trust_remote_code=False, token=False,
                    do_validation=False, cache_dir=str(CACHE / 'huggingface' / 'hub'),
                    library_name='transformers', batch_size=1, sequence_length=16)
        result['export_seconds'] = time.perf_counter() - t0
        write_json(phase_file, result)
        emit('export_done', model=key, seconds=result['export_seconds'])
    int8.mkdir(exist_ok=True)
    for p in fp32.iterdir():
        if p.is_file() and not p.name.endswith('.onnx'):
            shutil.copy2(p, int8 / p.name)
    # Keep the actual shipped tokenizer identical to the object used for timing,
    # including when resuming an existing ONNX export after tokenizer repair.
    tokenizer.save_pretrained(fp32)
    tokenizer.save_pretrained(int8)
    for name in GRAPH_NAMES:
        if not (int8 / name).exists():
            emit('quantize_start', model=key, graph=name)
            t0 = time.perf_counter()
            quantize_dynamic(str(fp32 / name), str(int8 / name),
                             op_types_to_quantize=['MatMul'], per_channel=True,
                             reduce_range=False, weight_type=QuantType.QInt8,
                             extra_options={'MatMulConstBOnly': True})
            result.setdefault('quantize_seconds', {})[name] = time.perf_counter() - t0
            write_json(phase_file, result)
    result['quantization'] = {'mode': 'dynamic', 'weight_type': 'QInt8', 'per_channel': True,
                              'reduce_range': False, 'op_types': ['MatMul'],
                              'MatMulConstBOnly': True, 'calibration_or_training': False}
    config = result['config_original']
    hidden = config.get('d_model', config.get('hidden_size'))
    result['artifacts'] = {name: inventory(path, config['vocab_size'], hidden)
                           for name, path in [('fp32', fp32), ('int8', int8)]}
    result['tokenizer_and_config_files'] = [file_info(p) for p in source.iterdir()
                                          if p.is_file() and p.suffix not in {'.safetensors', '.bin'}]
    result['runs'] = []
    for dtype, path in [('fp32', fp32), ('int8', int8)]:
        for threads in (1, 2):
            emit('measurement_start', model=key, dtype=dtype, threads=threads)
            result['runs'].append({'dtype': dtype, **measure(path, tokenizer, threads, warmups, repeats)})
            write_json(base / 'result.json', result)
    fp_run = next(r for r in result['runs'] if r['dtype'] == 'fp32' and r['threads'] == 1)
    result['fp32_pytorch_reference_fixed16_exact_ids'] = (
        fp_run['fixed_length'][0]['output_ids'] == result['pytorch_reference_fixed16']['output_ids'])
    int_run = next(r for r in result['runs'] if r['dtype'] == 'int8' and r['threads'] == 1)
    result['int8_vs_fp32_fixed_outputs'] = [
        {'length': a['length'], 'exact_ids': a['output_ids'] == b['output_ids'],
         'matching_positions': sum(x == y for x, y in zip(a['output_ids'], b['output_ids'])),
         'total_positions_including_decoder_start': len(a['output_ids'])}
        for a, b in zip(fp_run['fixed_length'], int_run['fixed_length'])]
    attach_deployment_metadata(result, base)
    write_json(base / 'result.json', result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=['all', *SPECS], default='all')
    parser.add_argument('--warmups', type=int, default=5)
    parser.add_argument('--repeats', type=int, default=10)
    parser.add_argument('--output', type=Path, default=ROOT / 'runtime/realizer/results/benchmark-cpu.json')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result = {'schema_version': 1, 'started_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'benchmark_script_sha256': sha_file(Path(__file__)),
              'hardware': hardware(), 'input_text': TEXT, 'models': [], 'errors': [],
              'method': {'batch': 1, 'greedy': True, 'warmups': args.warmups, 'repeats': args.repeats,
                         'onnx_opset': 17, 'merged_decoder': False,
                         'fixed_output_lengths': [16, 32], 'threads': [1, 2],
                         'fixed_length_note': 'min_new_tokens=max_new_tokens; early EOS suppressed by standard generation processor; configured forced EOS at final step remains unchanged. Natural-EOS smoke is also recorded.',
                         'quality_claim': 'No realizer quality claim; pretrained public checkpoints, no training.'}}
    for key in (SPECS if args.model == 'all' else [args.model]):
        try:
            result['models'].append(run_one(key, args.warmups, args.repeats))
        except Exception as exc:
            error = {'model': key, 'type': type(exc).__name__, 'message': str(exc), 'traceback': traceback.format_exc()}
            result['errors'].append(error)
            emit('error', **error)
        write_json(args.output, result)
    result['completed_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    write_json(args.output, result)
    emit('complete', output=str(args.output), models=len(result['models']), errors=len(result['errors']))
    return 1 if result['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
