import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { catchError, distinctUntilChanged, first, map, tap } from 'rxjs/operators';
import { doc, docData, Firestore, updateDoc, setDoc, collection, getDocs } from '@angular/fire/firestore';
import { AsyncPipe, NgForOf, NgIf } from '@angular/common';

interface Game {
  id: string;
  users: { id: string; hasLeft: boolean }[];
  status?: string; // Optional game status for demo purposes
}

@Component({
  selector: 'app-root',
  template: `
    <div *ngIf="game$ | async as game">
      <h1>Game ID: {{ game.id }}</h1>
      <h2>Status: {{ game.status }}</h2>
      <ul>
        <li *ngFor="let user of game.users">
          User ID: {{ user.id }} - Has Left: {{ user.hasLeft }}
        </li>
      </ul>
      <button (click)="updateGame()" style="padding: 20px">Update Game Status</button>
    </div>
  `,
  imports: [
    NgForOf,
    NgIf,
    AsyncPipe
  ],
  standalone: true,
})
export class AppComponent implements OnInit {
  private gameSubject$: BehaviorSubject<Game | null> = new BehaviorSubject<Game | null>(null);
  private gameSubscription: Subscription | undefined;
  private isCurrentlyLocked = false;
  private currentUserId = 'user123'; // Simulate a logged-in user
  private gameId = 'game123'; // Simulate a game document ID

  game$: Observable<Game | null> = this.gameSubject$.asObservable();

  constructor(private firestore: Firestore) {}

  ngOnInit() {
    this.checkAndCreateGame(this.gameId, this.currentUserId);
  }

  private async checkAndCreateGame(gameId: string, userId: string): Promise<void> {
    const gamesCollectionRef = collection(this.firestore, 'games');
    const gamesSnapshot = await getDocs(gamesCollectionRef);

    const gameExists = gamesSnapshot.docs.some(doc => doc.id === gameId);

    if (!gameExists) {
      console.log(`Game with ID ${gameId} does not exist. Creating...`);
      await this.createGame(gameId, userId);
    }

    this.loadGame(gameId, userId);
  }

  private async createGame(gameId: string, userId: string): Promise<void> {
    const gameDocRef = doc(this.firestore, 'games', gameId);
    const newGame: Game = {
      id: gameId,
      users: [
        { id: userId, hasLeft: false }
      ],
      status: 'Initialized'
    };

    await setDoc(gameDocRef, newGame);
    console.log(`Game with ID ${gameId} created.`);
  }

  private loadGame(gameId: string, userId: string): void {
    this.getGameById(gameId, userId).pipe(
      first(),
      tap(game => {
        if (!game) {
          throw new Error("assertion failed");
        }
        this.setGameStreamIfNull(game, userId);
      }),
      catchError(async (error) => {
        console.error('Load Game Error', error);
      })
    ).subscribe();
  }

  private getGameById(gameId: string, currentUserId: string): Observable<Game | null> {
    const gameDocRef = doc(this.firestore, 'games', gameId);
    console.log("🟩 CALLING DOC_DATA");

    const game$ = docData(gameDocRef, { idField: 'id' }).pipe(
      map(data => (data ? (data as Game) : null))
    );

    return game$.pipe(
      map(game => {
        if (!game) return null;

        const currentUser = game.users.find(user => user.id === currentUserId);
        if (!currentUser || currentUser.hasLeft) return null;

        const currentGame = this.gameSubject$.getValue();
        const currentGameJSON = JSON.stringify(currentGame);
        const newGameJSON = JSON.stringify(game);
        if (currentGameJSON === newGameJSON) {
          console.error("SAME GAME EMISSION", currentGameJSON);
        }
        return game;
      }),
      distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr))
    );
  }

  private setGameStreamIfNull(game: Game, userId: string): void {
    const currentValue = this.gameSubject$.getValue();
    if (currentValue === null && !this.isCurrentlyLocked) {
      this.isCurrentlyLocked = true;
      this.gameSubscription = this.getGameById(game.id, userId).pipe(distinctUntilChanged()).subscribe(gameData => {
        if (gameData === null) {
          this.gameSubscription?.unsubscribe();
        }
        console.log("🟦 Stream Emission, nexting", gameData);
        this.gameSubject$.next(gameData);
        this.isCurrentlyLocked = false;
      });
    }
  }

  updateGame(): void {
    const gameDocRef = doc(this.firestore, 'games', this.gameId);
    const newStatus = `Updated at ${new Date().toLocaleTimeString()}`;

    updateDoc(gameDocRef, { status: newStatus }).then(() => {
      console.log('Game status updated to:', newStatus);
    }).catch(error => {
      console.error('Error updating game:', error);
    });
  }
}
