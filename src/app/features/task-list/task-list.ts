import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { emit, listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from '@tauri-apps/plugin-notification';
import { FormsModule } from '@angular/forms';
import { TaskStoreService } from '../../core/task-store.service';
import { Task } from '../../shared/task.model';

@Component({
  selector: 'app-task-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './task-list.html',
  styleUrl: './task-list.css',
})
export class TaskList implements OnInit, OnDestroy {
  private readonly taskStore = inject(TaskStoreService);
  private unlistenTasksUpdated?: () => void;

  tasks = signal<Task[]>([]);
  newTitle = '';
  newPriority: Task['priority'] = 'medium';

  async ngOnInit(): Promise<void> {
    if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      this.unlistenTasksUpdated = await listen('tasks-updated', () => {
        void this.refresh().catch(error => {
          console.error('Failed to refresh tasks after a cross-window update:', error);
        });
      });
    }
    await this.refresh();
  }

  ngOnDestroy(): void {
    this.unlistenTasksUpdated?.();
  }

  async refresh(): Promise<void> {
    this.tasks.set(await this.taskStore.getAllTasks());
  }

  async addTask(): Promise<void> {
    if (!this.newTitle.trim()) return;

    await this.taskStore.createTask({
      title: this.newTitle.trim(),
      priority: this.newPriority
    });
    await emit('tasks-updated');
    this.newTitle = '';
    await this.refresh();
  }

  async toggleComplete(task: Task): Promise<void> {
    const updated = await this.taskStore.toggleComplete(task.id);
    await this.refresh();

    if (updated?.completed) {
      console.log('Emitting task-completed payload:', { title: updated.title });
      await emit('task-completed', { title: updated.title });
      await this.notifyTaskComplete(updated.title);
    }
  }

  private async notifyTaskComplete(title: string): Promise<void> {
    try {
      let granted = await isPermissionGranted();
      console.log('Notification permission granted:', granted);

      if (!granted) {
        const permission = await requestPermission();
        console.log('Notification permission request result:', permission);
        granted = permission === 'granted';
      }

      if (!granted) {
        console.warn('Notification permission was not granted.');
        return;
      }

      await sendNotification({
        title: 'Milly',
        body: `🎉 Task completed: ${title}`
      });
      console.log('Task completion notification sent.');
    } catch (error) {
      console.error('Failed to send task completion notification:', error);
    }
  }

  async deleteTask(task: Task): Promise<void> {
    await this.taskStore.deleteTask(task.id);
    await emit('tasks-updated');
    await this.refresh();
  }
}
