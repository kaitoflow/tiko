export function taskReplyProtocol(entry, taskId) {
  if (entry.role==='user' || !(entry.kind==='send-message'||entry.role==='assistant'||entry.role==='agent') || entry.truncated || entry.isStreaming)
    return {complete:false};
  // The Bot often fences the protocol header and footer separately. Fences
  // are presentation, not evidence that the reply was cut off.
  const lines=String(entry.text??'').split(/\r?\n/).filter(line=>!/^\s*`{3,}(?:[a-zA-Z0-9_-]+)?\s*$/.test(line)).map(line=>line.trim());
  const begin=lines.indexOf(`${taskId} BEGIN`),end=lines.lastIndexOf(`${taskId} END`);
  if(begin<0||end<=begin||lines.slice(end+1).some(Boolean))return {complete:false};
  if(lines.filter(l=>l===`${taskId} BEGIN`).length!==1||lines.filter(l=>l===`${taskId} END`).length!==1)return {complete:false};
  const body=lines.slice(begin+1,end);
  if(body.filter(l=>/^mode:\s*(analysis|design|grill|review)$/.test(l)).length!==1||body.filter(l=>/^status:\s*(complete|needs_user|needs_evidence)$/.test(l)).length!==1)return {complete:false};
  const mode=body.find(line=>/^mode:\s*(analysis|design|grill|review)$/.test(line))?.split(':')[1].trim();
  const status=body.find(line=>/^status:\s*(complete|needs_user|needs_evidence)$/.test(line))?.split(':')[1].trim();
  return {complete:Boolean(mode&&status),...(mode?{mode}:{}),...(status?{status}:{})};
}
