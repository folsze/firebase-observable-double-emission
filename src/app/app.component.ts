import { Component, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { catchError, distinctUntilChanged, first, map, tap } from 'rxjs/operators';
import { doc, docData, Firestore, getDoc, updateDoc, setDoc, collection, getDocs } from '@angular/fire/firestore';
import { AsyncPipe, NgForOf, NgIf } from '@angular/common';

interface Game {
  id: string;
  users: { id: string; hasLeft: boolean }[];
  status?: string; // Optional game status for demo purposes
}

function deepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;

  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
    return false;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (let key of keys1) {
    if (!keys2.includes(key)) return false;

    if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
      if (!deepEqual(obj1[key], obj2[key])) return false;
    } else if (obj1[key] !== obj2[key]) {
      return false;
    }
  }

  return true;
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
  private currentUserId = 'user123'; // Simulate a logged-in user
  private gameId = 'game123'; // Simulate a game document ID
  private streamInitialized = false; // Flag to prevent multiple stream creations

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

  private async loadGame(gameId: string, userId: string): Promise<void> {
    if (!this.streamInitialized) {
      console.log("🟩 Initializing stream using docData...");
      this.streamInitialized = true;
      this.setGameStream(gameId, userId);
    } else {
      console.log("Fetching game data without stream...");
      const gameData = await this.fetchGameWithoutStream(gameId, userId);
      if (gameData) {
        this.gameSubject$.next(gameData);
      }
    }
  }

  private setGameStream(gameId: string, userId: string): void {
    this.gameSubscription = this.getGameDocData(gameId, userId).pipe(
      // distinctUntilChanged((prev, curr) => deepEqual(prev, curr)) // TODO: NOTE THIS: this would ofc prevent double emissions, but not intrinsically prevent emissions. And it's computationally expensive with large games.
    ).subscribe(gameData => {
      if (gameData === null) {
        this.gameSubscription?.unsubscribe();
      }
      console.log("🟦 Stream Emission, nexting", gameData);
      const currentGame = this.gameSubject$.getValue();
      if (currentGame && deepEqual(currentGame, gameData)) {
        console.error("SAME GAME EMISSION", JSON.stringify(gameData));
      }
      this.gameSubject$.next(gameData);
    });
  }

  private getGameDocData(gameId: string, currentUserId: string): Observable<Game | null> {
    const gameDocRef = doc(this.firestore, 'games', gameId);

    const game$ = docData(gameDocRef, { idField: 'id' }).pipe(
      map(data => (data ? (data as Game) : null)),
      tap((data) => {
        console.log("🔵 intrinsic stream emission:", data);
      })
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
          console.error("SAME GAME EMISSION DETECTED", currentGameJSON);
        }
        return game;
      })
    );
  }

  private async fetchGameWithoutStream(gameId: string, userId: string): Promise<Game | null> {
    const gameDocRef = doc(this.firestore, 'games', gameId);
    const docSnapshot = await getDoc(gameDocRef);

    if (docSnapshot.exists()) {
      const game = docSnapshot.data() as Game;
      const currentUser = game.users.find(user => user.id === userId);
      if (!currentUser || currentUser.hasLeft) {
        return null;
      }
      return game;
    } else {
      console.log("Game document not found!");
      return null;
    }
  }

  updateGame(): void {
    const gameDocRef = doc(this.firestore, 'games', this.gameId);
    const newStatus = `Updated at ${new Date().toLocaleTimeString()}`;

    console.log("🟨 Gonna update game now:")
    updateDoc(gameDocRef, { status: newStatus }).then(() => {
      // console.log('Game status updated to:', newStatus);
    }).catch(error => {
      console.error('Error updating game:', error);
    });
  }
}
