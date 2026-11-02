import hashlib
import json
import os
import tempfile
import threading
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app, Response, send_file
from flask_login import login_required, current_user
from sqlalchemy import func
from werkzeug.utils import secure_filename

from app.models import db, BatchRule, BatchRun, BatchRunFile, BatchRunStep
from app.services.excel_service import ExcelService
from app.services import batch_service as batch
from app.services.batch_report import build_run_report, build_report_excel

bp = Blueprint('batch', __name__)

ALLOWED_EXTENSIONS = {'xlsx', 'xls'}


def _rule_or_404(rule_id):
    return BatchRule.query.filter_by(id=rule_id, user_id=current_user.id).first()


def _run_or_404(run_id):
    return BatchRun.query.filter_by(id=run_id, user_id=current_user.id).first()


def _rule_payload():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    match_text = (data.get('match_text') or '').strip()
    steps = batch.clean_rule_steps(data.get('steps'))
    errors = batch.validate_rule(name, steps, set(batch.user_configs(current_user.id)))
    return name, match_text, steps, errors


# ---------- Rules ----------

@bp.route('/rules', methods=['GET'])
@login_required
def list_rules():
    rules = BatchRule.query.filter_by(user_id=current_user.id).order_by(BatchRule.name).all()
    return jsonify({'success': True, 'rules': [batch.serialize_rule(r) for r in rules]}), 200


@bp.route('/rules', methods=['POST'])
@login_required
def create_rule():
    name, match_text, steps, errors = _rule_payload()
    if errors:
        return jsonify({'error': '; '.join(errors), 'errors': errors}), 400
    rule = BatchRule(user_id=current_user.id, name=name, match_text=match_text, steps_json=json.dumps(steps))
    db.session.add(rule)
    db.session.commit()
    current_app.logger.info(f'Batch rule created: {rule.id} {name}')
    return jsonify({'success': True, 'rule': batch.serialize_rule(rule)}), 201


@bp.route('/rules/<int:rule_id>', methods=['PUT'])
@login_required
def update_rule(rule_id):
    rule = _rule_or_404(rule_id)
    if not rule:
        return jsonify({'error': 'Rule not found'}), 404
    name, match_text, steps, errors = _rule_payload()
    if errors:
        return jsonify({'error': '; '.join(errors), 'errors': errors}), 400
    rule.name, rule.match_text, rule.steps_json = name, match_text, json.dumps(steps)
    db.session.commit()
    return jsonify({'success': True, 'rule': batch.serialize_rule(rule)}), 200


@bp.route('/rules/<int:rule_id>', methods=['DELETE'])
@login_required
def delete_rule(rule_id):
    rule = _rule_or_404(rule_id)
    if not rule:
        return jsonify({'error': 'Rule not found'}), 404
    db.session.delete(rule)
    db.session.commit()
    return jsonify({'success': True}), 200


# ---------- Runs ----------

@bp.route('/runs', methods=['GET'])
@login_required
def list_runs():
    runs = (BatchRun.query.filter_by(user_id=current_user.id)
            .order_by(BatchRun.id.desc()).limit(100).all())
    return jsonify({'success': True, 'runs': [batch.serialize_run(r, include_files=False) for r in runs]}), 200


@bp.route('/runs', methods=['POST'])
@login_required
def create_run():
    run = BatchRun(user_id=current_user.id, status='draft')
    db.session.add(run)
    db.session.commit()
    return jsonify({'success': True, 'run': batch.serialize_run(run)}), 201


@bp.route('/runs/<int:run_id>', methods=['GET'])
@login_required
def get_run(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    include_logs = request.args.get('logs') == '1'
    return jsonify({'success': True, 'run': batch.serialize_run(run, include_logs=include_logs)}), 200


@bp.route('/runs/<int:run_id>', methods=['DELETE'])
@login_required
def delete_run(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    if run.status != 'draft':
        return jsonify({'error': 'Only runs that have not been started can be discarded'}), 409
    db.session.delete(run)
    db.session.commit()
    return jsonify({'success': True}), 200


@bp.route('/runs/<int:run_id>/log.txt', methods=['GET'])
@login_required
def download_run_log(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    return Response(
        batch.format_run_log(run),
        mimetype='text/plain',
        headers={'Content-Disposition': f'attachment; filename=batch-run-{run.id}-log.txt'}
    )


@bp.route('/runs/<int:run_id>/report', methods=['GET'])
@login_required
def get_run_report(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    return jsonify({'success': True, 'report': build_run_report(batch.serialize_run(run))}), 200


@bp.route('/runs/<int:run_id>/report.xlsx', methods=['GET'])
@login_required
def download_run_report(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    buf = build_report_excel(build_run_report(batch.serialize_run(run)))
    return send_file(buf, as_attachment=True, download_name=f'monthly-run-{run.id}-report.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')


@bp.route('/runs/<int:run_id>/cancel', methods=['POST'])
@login_required
def cancel_run(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    if run.status != 'running':
        return jsonify({'error': 'The run is not running'}), 409
    run.cancel_requested = True
    batch.add_log(run, 'warning', 'Cancel requested: stopping after the document being created now')
    db.session.commit()
    return jsonify({'success': True, 'run': batch.serialize_run(run)}), 200


def _duplicate_warnings(run, sha256):
    warnings = []
    if any(f.sha256 == sha256 for f in run.files):
        warnings.append('The same file was already added to this run')
    earlier = (BatchRunFile.query.join(BatchRun)
               .filter(BatchRun.user_id == current_user.id, BatchRun.id != run.id, BatchRunFile.sha256 == sha256)
               .order_by(BatchRun.id.desc()).all())
    for other in earlier:
        if any(s.status == 'success' for s in other.steps):
            when = (other.run.started_at or other.run.created_at).strftime('%Y-%m-%d')
            warnings.append(f'This exact file was already processed in run #{other.run.id} on {when}')
            break
    return warnings


@bp.route('/runs/<int:run_id>/files', methods=['POST'])
@login_required
def add_run_file(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    if run.status != 'draft':
        return jsonify({'error': 'Files can only be added before the run starts'}), 409

    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'No file provided'}), 400

    content = file.read()
    sha256 = hashlib.sha256(content).hexdigest()
    run_file = BatchRunFile(
        run_id=run.id,
        position=len(run.files),
        filename=file.filename,
        sha256=sha256,
        warnings_json=json.dumps(_duplicate_warnings(run, sha256)),
    )
    run.files.append(run_file)

    extension = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if extension not in ALLOWED_EXTENSIONS:
        run_file.error = 'Not an Excel file (.xlsx or .xls)'
    else:
        fd, path = tempfile.mkstemp(suffix='-' + secure_filename(file.filename))
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(content)
            ok, rows, message = ExcelService().process_excel_file(path)
        finally:
            os.unlink(path)
        if ok:
            run_file.rows_json = json.dumps(rows)
        else:
            run_file.error = message
    db.session.flush()

    if run_file.error:
        batch.add_log(run, 'error', f'{run_file.filename}: could not read file: {run_file.error}', run_file=run_file)
    else:
        rule = None
        rule_id = request.form.get('rule_id', type=int)
        if rule_id:
            rule = _rule_or_404(rule_id)
        else:
            rules = BatchRule.query.filter_by(user_id=current_user.id).all()
            matched = batch.match_rule_for_filename(
                file.filename, [{'id': r.id, 'match_text': r.match_text} for r in rules]
            )
            rule = next((r for r in rules if matched and r.id == matched['id']), None)
        if rule:
            batch.plan_file(run_file, rule, batch.user_configs(current_user.id))
        batch.add_log(run, 'info', f'{run_file.filename}: added with {len(json.loads(run_file.rows_json))} row(s), '
                                   f"rule: {rule.name if rule else 'none'}", run_file=run_file)

    db.session.commit()
    return jsonify({'success': True, 'run': batch.serialize_run(run)}), 201


@bp.route('/runs/<int:run_id>/files/<int:file_id>', methods=['PUT'])
@login_required
def change_file_rule(run_id, file_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    if run.status != 'draft':
        return jsonify({'error': 'The rule can only be changed before the run starts'}), 409
    run_file = BatchRunFile.query.filter_by(id=file_id, run_id=run.id).first()
    if not run_file or run_file.error:
        return jsonify({'error': 'File not found'}), 404

    rule_id = (request.get_json() or {}).get('rule_id')
    if rule_id:
        rule = _rule_or_404(rule_id)
        if not rule:
            return jsonify({'error': 'Rule not found'}), 404
        batch.plan_file(run_file, rule, batch.user_configs(current_user.id))
    else:
        for old in list(run_file.steps):
            run_file.steps.remove(old)
        run_file.rule_id = None
        run_file.rule_name = None
    db.session.commit()
    return jsonify({'success': True, 'run': batch.serialize_run(run)}), 200


@bp.route('/runs/<int:run_id>/files/<int:file_id>', methods=['DELETE'])
@login_required
def remove_run_file(run_id, file_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    if run.status != 'draft':
        return jsonify({'error': 'Files can only be removed before the run starts'}), 409
    run_file = BatchRunFile.query.filter_by(id=file_id, run_id=run.id).first()
    if not run_file:
        return jsonify({'error': 'File not found'}), 404
    run.files.remove(run_file)
    db.session.commit()
    return jsonify({'success': True, 'run': batch.serialize_run(run)}), 200


@bp.route('/runs/<int:run_id>/steps/<int:step_id>', methods=['PATCH'])
@login_required
def set_step_included(run_id, step_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    if run.status not in batch.EXECUTABLE_RUN_STATUSES:
        return jsonify({'error': 'The run is in progress'}), 409
    step = BatchRunStep.query.filter_by(id=step_id, run_id=run.id).first()
    if not step:
        return jsonify({'error': 'Step not found'}), 404

    data = request.get_json() or {}
    if 'hold' in data:
        changed = batch.set_step_hold(step, bool(data['hold']))
        if changed:
            what = ', '.join(batch.step_title(s) for s in changed)
            batch.add_log(run, 'info', f"{step.run_file.filename} › {what}: "
                                       f"{'put on hold for later' if data['hold'] else 'taken off hold'}", step=step)
        db.session.commit()
        return jsonify({'success': True, 'run': batch.serialize_run(run)}), 200

    included = bool(data.get('included'))
    if included and step.status == 'excluded':
        step.status = 'pending'
    elif not included and step.status == 'interrupted':
        return jsonify({'error': 'This step may already be in the database; run it again so it can be checked'}), 409
    elif not included and step.status in batch.RETRYABLE_STATUSES:
        step.status = 'excluded'
    db.session.commit()
    return jsonify({'success': True, 'run': batch.serialize_run(run)}), 200


@bp.route('/runs/<int:run_id>/recheck', methods=['POST'])
@login_required
def recheck_run(run_id):
    run = _run_or_404(run_id)
    if not run:
        return jsonify({'error': 'Run not found'}), 404
    if run.status == 'running':
        return jsonify({'error': 'The run is in progress'}), 409
    file_id = (request.get_json(silent=True) or {}).get('file_id')
    configs = batch.user_configs(current_user.id)
    checked = 0
    for run_file in run.files:
        if run_file.error or not run_file.steps or (file_id and run_file.id != file_id):
            continue
        checked += batch.preview_file(run_file, configs)
    batch.add_log(run, 'info', f'Re-checked {checked} document(s) against the databases')
    db.session.commit()
    return jsonify({'success': True, 'checked': checked, 'run': batch.serialize_run(run)}), 200


@bp.route('/runs/<int:run_id>/execute', methods=['POST'])
@login_required
def execute_run(run_id):
    claimed = (BatchRun.query
               .filter(BatchRun.id == run_id, BatchRun.user_id == current_user.id,
                       BatchRun.status.in_(batch.EXECUTABLE_RUN_STATUSES))
               .update({'status': 'running', 'started_at': func.coalesce(BatchRun.started_at, datetime.utcnow()),
                        'finished_at': None,
                        'cancel_requested': False, 'notice': None},
                        synchronize_session=False))
    db.session.commit()
    if not claimed:
        run = _run_or_404(run_id)
        if not run:
            return jsonify({'error': 'Run not found'}), 404
        return jsonify({'error': 'This run is already running or has nothing left to do'}), 409

    app = current_app._get_current_object()

    def work():
        with app.app_context():
            batch.execute_run(run_id)
            db.session.remove()

    threading.Thread(target=work, name=f'batch-run-{run_id}', daemon=True).start()
    run = _run_or_404(run_id)
    return jsonify({'success': True, 'run': batch.serialize_run(run)}), 202
