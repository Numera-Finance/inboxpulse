import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTaskClient } from '../lib/clients';
import type { Task, TaskComment, AssignableUser } from '@crm/clients';
import { TaskStatus } from '@crm/clients';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Send,
  UserCircle,
  Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '../lib/utils';

interface EscalationListProps {
  customerId: string;
}

export function EscalationList({ customerId }: EscalationListProps): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['tasks', 'customer', customerId],
    queryFn: async () => {
      const client = getTaskClient();
      return client.search({
        customerId,
        status: 'open',
        sortBy: 'createdAt',
        sortOrder: 'desc',
        limit: 20,
      });
    },
    staleTime: 30_000,
  });

  const tasks = data?.items ?? [];

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <AlertTriangle size={14} className="text-destructive" />
        <h3 className="text-xs font-semibold">Open Escalations</h3>
        {tasks.length > 0 && (
          <span className="ml-auto rounded-full bg-destructive/10 text-destructive text-xs font-medium px-1.5 py-0.5">
            {data?.total ?? tasks.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="p-3 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground text-center">
          No open escalations
        </div>
      ) : (
        <div className="divide-y divide-border">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }: { task: Task }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-2 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-start gap-2">
          {expanded ? (
            <ChevronDown size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate">{task.title}</p>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              {task.assignedToName && (
                <span className="flex items-center gap-1">
                  <UserCircle size={10} />
                  {task.assignedToName}
                </span>
              )}
              <span>{formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}</span>
            </div>
          </div>
        </div>
      </button>

      {expanded && <TaskDetails task={task} />}
    </div>
  );
}

function TaskDetails({ task }: { task: Task }): React.ReactElement {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState('');

  // Fetch comments
  const { data: comments } = useQuery<TaskComment[]>({
    queryKey: ['tasks', task.id, 'comments'],
    queryFn: async () => {
      const client = getTaskClient();
      return client.getComments(task.id);
    },
    staleTime: 30_000,
  });

  // Fetch assignable users
  const { data: assignableUsers } = useQuery<AssignableUser[]>({
    queryKey: ['tasks', 'assignable-users'],
    queryFn: async () => {
      const client = getTaskClient();
      return client.getAssignableUsers();
    },
    staleTime: 120_000,
  });

  // Mark done mutation
  const markDoneMutation = useMutation({
    mutationFn: async () => {
      const client = getTaskClient();
      return client.markDone(task.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'customer', task.customerId] });
    },
  });

  // Add comment mutation
  const addCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      const client = getTaskClient();
      return client.addComment(task.id, content);
    },
    onSuccess: () => {
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['tasks', task.id, 'comments'] });
    },
  });

  // Reassign mutation
  const reassignMutation = useMutation({
    mutationFn: async (assignedToId: string | null) => {
      const client = getTaskClient();
      return client.reassign(task.id, assignedToId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'customer', task.customerId] });
    },
  });

  const handleSubmitComment = (): void => {
    const trimmed = commentText.trim();
    if (trimmed) {
      addCommentMutation.mutate(trimmed);
    }
  };

  return (
    <div className="px-3 pb-3 space-y-2">
      {/* Email context */}
      {task.emailSubject && (
        <div className="rounded bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium">Email:</span> {task.emailSubject}
        </div>
      )}

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => markDoneMutation.mutate()}
          disabled={markDoneMutation.isPending}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
            'bg-success/10 text-success hover:bg-success/20',
            'disabled:opacity-50',
          )}
        >
          {markDoneMutation.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <CheckCircle2 size={12} />
          )}
          Mark Done
        </button>

        {assignableUsers && assignableUsers.length > 0 && (
          <select
            value={task.assignedToId ?? ''}
            onChange={(e) => {
              const value = e.target.value || null;
              reassignMutation.mutate(value);
            }}
            disabled={reassignMutation.isPending}
            className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
          >
            <option value="">Unassigned</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Comments */}
      {comments && comments.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <MessageSquare size={10} />
            <span className="font-medium">Comments ({comments.length})</span>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {comments.map((comment) => (
              <div key={comment.id} className="rounded bg-muted/50 px-2 py-1 text-xs">
                <span className="font-medium">{comment.userName}:</span>{' '}
                {comment.content}
                <span className="text-muted-foreground ml-1">
                  {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add comment */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmitComment();
            }
          }}
          placeholder="Add a comment..."
          className="flex-1 rounded border border-input bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleSubmitComment}
          disabled={!commentText.trim() || addCommentMutation.isPending}
          className="rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
        >
          {addCommentMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </button>
      </div>

      {/* Error messages */}
      {markDoneMutation.error && (
        <p className="text-xs text-destructive">
          {(markDoneMutation.error as Error).message}
        </p>
      )}
      {addCommentMutation.error && (
        <p className="text-xs text-destructive">
          {(addCommentMutation.error as Error).message}
        </p>
      )}
      {reassignMutation.error && (
        <p className="text-xs text-destructive">
          {(reassignMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
