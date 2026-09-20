import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject
} from '@angular/core';
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
export class TaskList implements OnInit {
  private readonly taskStore = inject(TaskStoreService);

  tasks: Task[] = [];
  newTitle = '';
  newPriority: Task['priority'] = 'medium';

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    this.tasks = await this.taskStore.getAllTasks();
  }

  async addTask(): Promise<void> {
    if (!this.newTitle.trim()) return;

    await this.taskStore.createTask({
      title: this.newTitle.trim(),
      priority: this.newPriority
    });
    this.newTitle = '';
    await this.refresh();
  }

  async toggleComplete(task: Task): Promise<void> {
    await this.taskStore.toggleComplete(task.id);
    await this.refresh();
  }

  async deleteTask(task: Task): Promise<void> {
    await this.taskStore.deleteTask(task.id);
    await this.refresh();
  }
}
